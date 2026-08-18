/**
 * Configuration options for the AuditRails client.
 */
export interface AuditRailsOptions {
  /** API key (starts with at_live_ or at_test_) */
  apiKey: string;

  /** Base URL for the ingestion API. Defaults to https://api.auditrails.io */
  baseUrl?: string;

  /** Maximum number of events to buffer before flushing. Defaults to 100. */
  batchSize?: number;

  /** Flush interval in milliseconds. Defaults to 1000 (1 second). */
  flushInterval?: number;

  /** Maximum number of retry attempts for failed requests. Defaults to 3. */
  maxRetries?: number;

  /** Request timeout in milliseconds. Defaults to 10000 (10 seconds). */
  timeout?: number;

  /** Whether to register process exit handlers for graceful shutdown. Defaults to true. */
  autoShutdown?: boolean;

  /** Optional logger. Defaults to silent (no logging). */
  logger?: Logger;
}

/**
 * An audit event to log.
 */
export interface AuditEvent {
  /** The action being logged. Use Actions constants (e.g. Actions.Auth.Login) or a raw string. Required. */
  action: string;

  /** The ID of the actor performing the action (e.g. user ID). */
  actorId?: string;

  /** The resource being acted upon (e.g. "document/doc-123"). */
  resource?: string;

  /** Additional key-value metadata. Max 10 keys, values max 1KB each. */
  metadata?: Record<string, unknown>;
}

/**
 * Response from logging a single event.
 */
export interface LogResponse {
  logId: string;
  requestId: string;
}

/**
 * Response from logging a batch of events.
 */
export interface BatchResponse {
  logIds: string[];
  requestId: string;
}

/**
 * API error response.
 */
export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  docUrl: string;
}

/**
 * Logger interface for the SDK.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
