import type { ApiError } from './types.js';

/**
 * Error thrown when the AuditRails API returns an error response.
 */
export class AuditRailsError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string;
  readonly docUrl: string;

  constructor(statusCode: number, apiError: ApiError) {
    super(apiError.message);
    this.name = 'AuditRailsError';
    this.code = apiError.code;
    this.statusCode = statusCode;
    this.requestId = apiError.requestId;
    this.docUrl = apiError.docUrl;
  }

  /** Whether this error is retryable (5xx server errors). */
  get retryable(): boolean {
    return this.statusCode >= 500;
  }
}

/**
 * Error thrown when a request times out.
 */
export class AuditRailsTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'AuditRailsTimeoutError';
  }
}
