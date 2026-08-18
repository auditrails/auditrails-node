import { describe, it, expect } from 'vitest';
import { AuditRailsError, AuditRailsTimeoutError } from '../src/errors.js';

describe('AuditRailsError', () => {
  it('captures error details', () => {
    const err = new AuditRailsError(422, {
      code: 'validation/missing_action',
      message: "The 'action' field is required.",
      requestId: 'req_123',
      docUrl: 'https://docs.auditrails.io/errors/validation/missing_action',
    });

    expect(err.name).toBe('AuditRailsError');
    expect(err.message).toBe("The 'action' field is required.");
    expect(err.code).toBe('validation/missing_action');
    expect(err.statusCode).toBe(422);
    expect(err.requestId).toBe('req_123');
    expect(err.docUrl).toBe('https://docs.auditrails.io/errors/validation/missing_action');
  });

  it('retryable is true for 5xx', () => {
    const err = new AuditRailsError(500, {
      code: 'event/write_failed',
      message: 'Internal error',
      requestId: '',
      docUrl: '',
    });
    expect(err.retryable).toBe(true);
  });

  it('retryable is false for 4xx', () => {
    const err = new AuditRailsError(429, {
      code: 'rate/limit_exceeded',
      message: 'Rate limit exceeded',
      requestId: '',
      docUrl: '',
    });
    expect(err.retryable).toBe(false);
  });

  it('is instanceof Error', () => {
    const err = new AuditRailsError(400, {
      code: 'test',
      message: 'test',
      requestId: '',
      docUrl: '',
    });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AuditRailsTimeoutError', () => {
  it('includes timeout duration in message', () => {
    const err = new AuditRailsTimeoutError(10000);
    expect(err.message).toBe('Request timed out after 10000ms');
    expect(err.name).toBe('AuditRailsTimeoutError');
  });
});
