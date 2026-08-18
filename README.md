# @auditrails/node

Official Node.js / TypeScript SDK for [auditrails.io](https://auditrails.io) — tamper-proof audit logging as a service.

## Install

```bash
npm install @auditrails/node
```

Requires Node.js 18+ (uses native `fetch`).

## Quick Start

```typescript
import { AuditRails, Actions } from '@auditrails/node';

const audit = new AuditRails({
  apiKey: process.env.AUDITRAILS_API_KEY!,
});

// Fire-and-forget (buffered, auto-flushed)
audit.log({
  action: Actions.Auth.Login,   // typed compliance action constant
  actorId: 'user_123',
  resource: 'session/sess_456',
  metadata: { ip: '1.2.3.4', method: 'password' },
});

// Before process exit
await audit.close();
```

That's it. Your first audit event in under 2 minutes.

### Compliance Action Constants

The SDK exports typed `Actions` constants for all 42 compliance actions. Use these instead of raw strings to ensure your events match the compliance catalog:

```typescript
import { Actions } from '@auditrails/node';

audit.log({ action: Actions.Auth.Login, actorId: 'user_1' });
audit.log({ action: Actions.Auth.Logout, actorId: 'user_1' });
audit.log({ action: Actions.Consent.Given, actorId: 'user_1', metadata: { purpose: 'marketing' } });
audit.log({ action: Actions.PhiAccess.Accessed, actorId: 'user_1', resource: 'patient/123' });
```

Raw strings are still accepted for backward compatibility — the `action` field type is `string`.

## API

### `new AuditRails(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | Your API key (`at_live_...` or `at_test_...`) |
| `baseUrl` | `string` | `https://api.auditrails.io` | Ingestion API URL |
| `batchSize` | `number` | `100` | Max events per batch (max 100) |
| `flushInterval` | `number` | `1000` | Auto-flush interval in ms |
| `maxRetries` | `number` | `3` | Retry attempts for 5xx errors |
| `timeout` | `number` | `10000` | Request timeout in ms |
| `autoShutdown` | `boolean` | `true` | Register process exit handlers |
| `logger` | `Logger` | silent | Optional logger (`console` works) |

### `audit.log(event)`

Buffer an event for batch sending. **Never throws** — errors are logged silently.

```typescript
audit.log({
  action: 'document.created',    // required
  actorId: 'user_123',           // who did it
  resource: 'document/doc-456',  // what was affected
  metadata: { key: 'value' },    // extra context (max 10 keys)
});
```

### `audit.logDirect(event): Promise<LogResponse>`

Send a single event immediately and await the response. Throws on error.

```typescript
const { logId, requestId } = await audit.logDirect({
  action: 'user.deleted',
  actorId: 'admin_1',
});
```

### `audit.logBatchDirect(events): Promise<BatchResponse>`

Send a batch of events immediately and await the response. Throws on error.

### `audit.flush(): Promise<void>`

Flush all buffered events immediately.

### `audit.close(): Promise<void>`

Flush remaining events and shut down. After calling `close()`, `log()` calls are silently ignored.

## Error Handling

The SDK is designed to **never crash your application**:

- `log()` never throws — errors are logged via the optional `logger`
- `logDirect()` and `logBatchDirect()` throw `AuditRailsError` on API errors
- 5xx errors are retried with exponential backoff
- 4xx errors fail immediately (no retry)
- Network errors and timeouts are retried

```typescript
import { AuditRailsError } from '@auditrails/node';

try {
  await audit.logDirect({ action: 'test' });
} catch (err) {
  if (err instanceof AuditRailsError) {
    console.log(err.code);       // 'validation/missing_action'
    console.log(err.statusCode); // 422
    console.log(err.requestId);  // 'req_...'
    console.log(err.docUrl);     // link to docs
  }
}
```

## License

MIT
