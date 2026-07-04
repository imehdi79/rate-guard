import { Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import pretty from 'pino-pretty';

/**
 * Request state attached by upstream middleware/guards that the logger
 * reads: pino-http sets id, AuthGuard sets tenant, RateLimitGuard sets
 * rateLimit.
 */
interface RequestContext {
  id?: string | number;
  tenant?: { id: string };
  rateLimit?: { allowed: boolean };
}

/**
 * Reuse the caller's X-Request-Id when present (so client retries and the
 * ViolationLog request_id line up), otherwise mint one. Echoed back in the
 * response so clients can quote it.
 */
const correlationId = (req: IncomingMessage, res: ServerResponse): string => {
  const header = req.headers['x-request-id'];
  const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
};

// Human-readable one-line logs in development, JSON to stdout otherwise
// (collector-friendly). pino-pretty runs as an in-process stream, not a
// pino `transport`: transports spawn worker threads that resolve their
// worker.js relative to __dirname, which breaks inside the webpack bundle.
const prettyStream =
  process.env.NODE_ENV === 'development' || process.env.LOG_PRETTY === 'true'
    ? pretty({ singleLine: true })
    : undefined;

const pinoHttpOptions: Options = {
  level: process.env.LOG_LEVEL ?? 'info',
  genReqId: correlationId,

  // The per-request completion log. Flat keys, one line per request:
  // {tenant_id, path, method, status, latency_ms, correlation_id, allowed}
  customAttributeKeys: { responseTime: 'latency_ms' },
  customProps: (req: IncomingMessage, res: ServerResponse) => {
    const ctx = req as IncomingMessage &
      RequestContext & { originalUrl?: string };
    // originalUrl, not url: express rewrites req.url relative to the
    // middleware mount point while the request is in flight.
    const url = ctx.originalUrl ?? req.url;
    return {
      correlation_id: ctx.id !== undefined ? String(ctx.id) : null,
      tenant_id: ctx.tenant?.id ?? null,
      path: url?.split('?')[0] ?? null,
      method: req.method,
      status: res.statusCode,
      // null when the rate limiter did not run (public routes).
      allowed: ctx.rateLimit?.allowed ?? null,
    };
  },

  // Minimal serializers double as the per-request child bindings, so
  // every log line inside a request's lifecycle carries req.id (the
  // correlation id). Headers are dropped entirely — the x-api-key
  // value must never reach the logs.
  serializers: {
    req: (req: {
      id: string | number;
      method: string;
      url: string;
      originalUrl?: string;
    }) => ({
      id: req.id,
      method: req.method,
      path: (req.originalUrl ?? req.url)?.split('?')[0],
    }),
    res: (res: { statusCode: number }) => ({ status: res.statusCode }),
  },
};

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      // nestjs-pino's default route is the express-4 style '*', which Nest 11
      // (path-to-regexp v8) converts to a pattern that does NOT match the
      // zero-segment path (GET /api under the global prefix) — those requests
      // would get no correlation id and no completion log. '/' registers the
      // middleware with app.use(), whose prefix matching covers every path.
      forRoutes: ['/'],
      // Tuple form only when the pretty stream exists: [options, undefined]
      // is not a valid [Options, DestinationStream] pair.
      pinoHttp: prettyStream ? [pinoHttpOptions, prettyStream] : pinoHttpOptions,
    }),
  ],
})
export class LoggerModule {}
