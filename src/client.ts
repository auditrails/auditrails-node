import type {
  AuditRailsOptions,
  AuditEvent,
  LogResponse,
  BatchResponse,
  Logger,
} from './types.js';
import { AuditRailsError, AuditRailsTimeoutError } from './errors.js';

const DEFAULT_BASE_URL = 'https://api.auditrails.io';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL = 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 10_000;
const MAX_BATCH_SIZE = 100;

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * AuditRails Node.js SDK client.
 *
 * Buffers events in memory and flushes them in batches to the AuditRails
 * ingestion API. Events are flushed automatically every `flushInterval`ms
 * or when the buffer reaches `batchSize` events.
 *
 * @example
 * ```typescript
 * const audit = new AuditRails({ apiKey: 'at_live_...' });
 *
 * audit.log({ action: 'user.login', actorId: 'user_123' });
 *
 * // Before process exit:
 * await audit.flush();
 * ```
 */
export class AuditRails {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly maxRetries: number;
  private readonly timeout: number;
  private readonly logger: Logger;

  private buffer: AuditEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private shutdownHandlers: (() => void)[] = [];

  constructor(options: AuditRailsOptions) {
    if (!options.apiKey) {
      throw new Error('AuditRails: apiKey is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.logger = options.logger ?? silentLogger;

    this.startTimer();

    if (options.autoShutdown !== false) {
      this.registerShutdownHandlers();
    }
  }

  /**
   * Log an audit event. The event is buffered and sent in the next batch flush.
   * This method never throws — errors are logged silently.
   */
  log(event: AuditEvent): void {
    if (this.closed) {
      this.logger.warn('AuditRails: client is closed, ignoring event');
      return;
    }

    if (!event.action) {
      this.logger.error('AuditRails: action is required, ignoring event');
      return;
    }

    this.buffer.push(event);
    this.logger.debug(`AuditRails: buffered event (${this.buffer.length}/${this.batchSize})`, {
      action: event.action,
    });

    if (this.buffer.length >= this.batchSize) {
      // Fire and forget — don't await
      this.flush().catch(() => {});
    }
  }

  /**
   * Immediately flush all buffered events to the API.
   * Call this before process exit to ensure all events are sent.
   */
  async flush(): Promise<void> {
    // Wait for any in-progress flush
    if (this.flushing) {
      await this.flushing;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const events = this.buffer.splice(0);
    this.flushing = this.sendBatch(events);

    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  /**
   * Log a single event directly (bypassing the buffer) and return the response.
   * Unlike `log()`, this method awaits the API response and may throw.
   */
  async logDirect(event: AuditEvent): Promise<LogResponse> {
    if (this.closed) {
      throw new Error('AuditRails: client is closed');
    }

    const response = await this.request<{ log_id: string; request_id: string }>(
      '/v1/events',
      {
        action: event.action,
        actor_id: event.actorId,
        resource: event.resource,
        metadata: event.metadata,
      },
    );

    return {
      logId: response.log_id,
      requestId: response.request_id,
    };
  }

  /**
   * Send a batch of events directly and return the response.
   * Unlike `log()`, this method awaits the API response and may throw.
   */
  async logBatchDirect(events: AuditEvent[]): Promise<BatchResponse> {
    if (this.closed) {
      throw new Error('AuditRails: client is closed');
    }

    if (events.length === 0) {
      throw new Error('AuditRails: events array is empty');
    }

    if (events.length > MAX_BATCH_SIZE) {
      throw new Error(`AuditRails: batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    const response = await this.request<{ log_ids: string[]; request_id: string }>(
      '/v1/events/batch',
      {
        events: events.map((e) => ({
          action: e.action,
          actor_id: e.actorId,
          resource: e.resource,
          metadata: e.metadata,
        })),
      },
    );

    return {
      logIds: response.log_ids,
      requestId: response.request_id,
    };
  }

  /**
   * Flush remaining events and stop the client.
   * After calling close(), `log()` calls will be silently ignored.
   */
  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    this.stopTimer();
    this.removeShutdownHandlers();

    await this.flush();
  }

  private startTimer(): void {
    if (this.flushInterval > 0) {
      this.timer = setInterval(() => {
        this.flush().catch(() => {});
      }, this.flushInterval);

      // Don't keep the process alive just for flushing
      if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
        this.timer.unref();
      }
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private registerShutdownHandlers(): void {
    const handler = () => {
      this.flush().catch(() => {});
    };

    const signals = ['beforeExit', 'SIGTERM', 'SIGINT'] as const;
    for (const signal of signals) {
      process.on(signal, handler);
      this.shutdownHandlers.push(() => process.removeListener(signal, handler));
    }
  }

  private removeShutdownHandlers(): void {
    for (const remove of this.shutdownHandlers) {
      remove();
    }
    this.shutdownHandlers = [];
  }

  private async sendBatch(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      if (events.length === 1) {
        await this.request('/v1/events', {
          action: events[0].action,
          actor_id: events[0].actorId,
          resource: events[0].resource,
          metadata: events[0].metadata,
        });
      } else {
        await this.request('/v1/events/batch', {
          events: events.map((e) => ({
            action: e.action,
            actor_id: e.actorId,
            resource: e.resource,
            metadata: e.metadata,
          })),
        });
      }

      this.logger.info(`AuditRails: flushed ${events.length} event(s)`);
    } catch (err) {
      this.logger.error(`AuditRails: failed to flush ${events.length} event(s)`, err);
      // Events are dropped — SDK never crashes the host application
    }
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 200ms, 400ms, 800ms, ...
        const delay = Math.min(200 * Math.pow(2, attempt - 1), 10_000);
        await sleep(delay);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'User-Agent': '@auditrails/node/1.0.0',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return (await response.json()) as T;
        }

        const errorBody = await response.json().catch(() => null) as {
          error?: { code?: string; message?: string; request_id?: string; doc_url?: string };
        } | null;

        const apiError = new AuditRailsError(response.status, {
          code: errorBody?.error?.code ?? 'unknown',
          message: errorBody?.error?.message ?? response.statusText,
          requestId: errorBody?.error?.request_id ?? '',
          docUrl: errorBody?.error?.doc_url ?? '',
        });

        // Only retry on 5xx errors
        if (!apiError.retryable) {
          throw apiError;
        }

        lastError = apiError;
        this.logger.warn(
          `AuditRails: request failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${apiError.message}`,
        );
      } catch (err) {
        if (err instanceof AuditRailsError && !err.retryable) {
          throw err;
        }

        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = new AuditRailsTimeoutError(this.timeout);
        } else if (!(err instanceof AuditRailsError)) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }

        this.logger.warn(
          `AuditRails: request error (attempt ${attempt + 1}/${this.maxRetries + 1}): ${lastError?.message}`,
        );
      }
    }

    throw lastError ?? new Error('AuditRails: request failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
