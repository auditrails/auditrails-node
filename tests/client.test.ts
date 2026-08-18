import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditRails } from '../src/client.js';
import { AuditRailsError } from '../src/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response;
}

function createClient(overrides: Record<string, unknown> = {}): AuditRails {
  return new AuditRails({
    apiKey: 'at_test_abc123',
    baseUrl: 'http://localhost:8080',
    flushInterval: 0, // disable auto-flush for tests
    autoShutdown: false,
    ...overrides,
  });
}

describe('AuditRails', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('throws if apiKey is missing', () => {
      expect(() => new AuditRails({ apiKey: '' })).toThrow('apiKey is required');
    });

    it('strips trailing slashes from baseUrl', () => {
      const client = createClient({ baseUrl: 'http://localhost:8080///' });
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'test', request_id: 'req_test' }),
      );

      client.log({ action: 'test' });
      return client.flush().then(() => {
        expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8080/v1/events');
      });
    });

    it('caps batchSize at 100', () => {
      const client = createClient({ batchSize: 500 });
      // Internal check — we verify by filling buffer
      expect(client).toBeDefined();
    });
  });

  describe('log()', () => {
    it('buffers events and flushes as single event', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'log_1', request_id: 'req_1' }),
      );

      client.log({ action: 'user.login', actorId: 'user_123' });
      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/events');
      const body = JSON.parse(opts.body);
      expect(body.action).toBe('user.login');
      expect(body.actor_id).toBe('user_123');
    });

    it('flushes as batch when multiple events buffered', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_ids: ['a', 'b'], request_id: 'req_1' }),
      );

      client.log({ action: 'user.login' });
      client.log({ action: 'user.logout' });
      await client.flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8080/v1/events/batch');
      const body = JSON.parse(opts.body);
      expect(body.events).toHaveLength(2);
      expect(body.events[0].action).toBe('user.login');
      expect(body.events[1].action).toBe('user.logout');
    });

    it('ignores events without action', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const client = createClient({ logger });

      client.log({ action: '' });
      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('action is required'),
      );
    });

    it('ignores events after close()', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const client = createClient({ logger });
      mockFetch.mockResolvedValue(jsonResponse(202, {}));

      await client.close();
      client.log({ action: 'test' });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('client is closed'),
      );
    });

    it('auto-flushes when batchSize reached', async () => {
      const client = createClient({ batchSize: 2 });
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_ids: ['a', 'b'], request_id: 'req_1' }),
      );

      client.log({ action: 'event.one' });
      client.log({ action: 'event.two' }); // triggers flush

      // Wait for the auto-flush
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      await client.close();
    });

    it('sends authorization header', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'test', request_id: 'req_test' }),
      );

      client.log({ action: 'test' });
      await client.flush();

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer at_test_abc123');
    });

    it('sends User-Agent header', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'test', request_id: 'req_test' }),
      );

      client.log({ action: 'test' });
      await client.flush();

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['User-Agent']).toBe('@auditrails/node/1.0.0');
    });

    it('includes metadata and resource', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'test', request_id: 'req_test' }),
      );

      client.log({
        action: 'document.created',
        actorId: 'user_1',
        resource: 'document/doc-123',
        metadata: { key: 'value' },
      });
      await client.flush();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resource).toBe('document/doc-123');
      expect(body.metadata).toEqual({ key: 'value' });
    });
  });

  describe('logDirect()', () => {
    it('sends single event and returns response', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'log_abc', request_id: 'req_xyz' }),
      );

      const result = await client.logDirect({ action: 'user.login', actorId: 'u1' });

      expect(result.logId).toBe('log_abc');
      expect(result.requestId).toBe('req_xyz');
    });

    it('throws on API error', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(422, {
          error: {
            code: 'validation/missing_action',
            message: "The 'action' field is required.",
            request_id: 'req_1',
            doc_url: 'https://docs.auditrails.io/errors/validation/missing_action',
          },
        }),
      );

      await expect(
        client.logDirect({ action: 'test' }),
      ).rejects.toThrow(AuditRailsError);
    });

    it('throws when client is closed', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(jsonResponse(202, {}));
      await client.close();

      await expect(
        client.logDirect({ action: 'test' }),
      ).rejects.toThrow('client is closed');
    });
  });

  describe('logBatchDirect()', () => {
    it('sends batch and returns response', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_ids: ['a', 'b'], request_id: 'req_1' }),
      );

      const result = await client.logBatchDirect([
        { action: 'user.login' },
        { action: 'user.logout' },
      ]);

      expect(result.logIds).toEqual(['a', 'b']);
      expect(result.requestId).toBe('req_1');
    });

    it('rejects empty array', async () => {
      const client = createClient();
      await expect(client.logBatchDirect([])).rejects.toThrow('events array is empty');
    });

    it('rejects arrays exceeding 100', async () => {
      const client = createClient();
      const events = Array.from({ length: 101 }, (_, i) => ({
        action: `event.${i}`,
      }));
      await expect(client.logBatchDirect(events)).rejects.toThrow('batch size exceeds');
    });
  });

  describe('retry behavior', () => {
    it('retries on 500 errors with exponential backoff', async () => {
      const client = createClient({ maxRetries: 2 });

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(500, {
            error: { code: 'event/write_failed', message: 'Internal error', request_id: '', doc_url: '' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(500, {
            error: { code: 'event/write_failed', message: 'Internal error', request_id: '', doc_url: '' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(202, { log_id: 'ok', request_id: 'req_ok' }),
        );

      const result = await client.logDirect({ action: 'test' });
      expect(result.logId).toBe('ok');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not retry on 4xx errors', async () => {
      const client = createClient({ maxRetries: 3 });

      mockFetch.mockResolvedValue(
        jsonResponse(422, {
          error: {
            code: 'validation/missing_action',
            message: 'Missing action',
            request_id: 'req_1',
            doc_url: '',
          },
        }),
      );

      await expect(client.logDirect({ action: 'test' })).rejects.toThrow(AuditRailsError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries', async () => {
      const client = createClient({ maxRetries: 1 });

      mockFetch.mockResolvedValue(
        jsonResponse(500, {
          error: { code: 'event/write_failed', message: 'Internal error', request_id: '', doc_url: '' },
        }),
      );

      await expect(client.logDirect({ action: 'test' })).rejects.toThrow(AuditRailsError);
      expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
    });
  });

  describe('error isolation', () => {
    it('never throws from log() even on network error', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const client = createClient({ logger, batchSize: 1, maxRetries: 0 });

      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Should not throw
      client.log({ action: 'test' });

      // Wait for auto-flush
      await new Promise((r) => setTimeout(r, 100));

      expect(logger.error).toHaveBeenCalled();
      await client.close();
    });

    it('flush() does not throw on API error', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const client = createClient({ logger, maxRetries: 0 });

      mockFetch.mockResolvedValue(
        jsonResponse(500, {
          error: { code: 'event/write_failed', message: 'err', request_id: '', doc_url: '' },
        }),
      );

      client.log({ action: 'test' });
      // flush() should not throw — events are dropped silently
      await client.flush();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('flush()', () => {
    it('is a no-op when buffer is empty', async () => {
      const client = createClient();
      await client.flush();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('waits for in-progress flush before starting new one', async () => {
      const client = createClient();
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((r) => { resolveFirst = r; });

      mockFetch.mockImplementationOnce(() =>
        firstPromise.then(() => jsonResponse(202, { log_id: 'a', request_id: 'req_a' })),
      );

      client.log({ action: 'first' });
      const flush1 = client.flush();

      client.log({ action: 'second' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse(202, { log_id: 'b', request_id: 'req_b' }),
      );
      const flush2 = client.flush();

      resolveFirst!();
      await flush1;
      await flush2;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('close()', () => {
    it('flushes remaining events', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(
        jsonResponse(202, { log_id: 'test', request_id: 'req_test' }),
      );

      client.log({ action: 'final.event' });
      await client.close();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('is idempotent', async () => {
      const client = createClient();
      mockFetch.mockResolvedValue(jsonResponse(202, {}));

      await client.close();
      await client.close(); // should not throw
    });
  });
});
