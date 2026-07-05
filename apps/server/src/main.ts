/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app/app.module';

type App = Awaited<ReturnType<typeof NestFactory.create>>;

/** Hard ceiling for draining in-flight requests and closing resources. */
const SHUTDOWN_DEADLINE_MS = 5_000;

/**
 * Deploy platforms (Railway, K8s, systemd, ...) send SIGTERM and expect the
 * process to finish what it is doing and exit on its own; without this,
 * every redeploy drops whatever requests are in flight. app.close() stops
 * accepting new connections, waits for in-flight responses to complete,
 * then runs the shutdown hooks that close the Prisma pool and the Redis
 * client. The deadline guarantees the platform never has to escalate to
 * SIGKILL if a request or a teardown hangs.
 */
function setupGracefulShutdown(app: App) {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      Logger.log(
        `${signal} received — draining in-flight requests`,
        'Shutdown',
      );
      const deadline = setTimeout(() => {
        Logger.error(
          `Shutdown exceeded ${SHUTDOWN_DEADLINE_MS}ms — forcing exit`,
          undefined,
          'Shutdown',
        );
        process.exit(1);
      }, SHUTDOWN_DEADLINE_MS);
      // Never keep the process alive just to run the failsafe timer.
      deadline.unref();

      app
        .close()
        .then(() => {
          Logger.log('Shutdown complete', 'Shutdown');
          process.exit(0);
        })
        .catch((error) => {
          Logger.error(`Shutdown failed: ${error}`, undefined, 'Shutdown');
          process.exit(1);
        });
    });
  }
}

/**
 * Security headers on every response. Helmet defaults already cover most;
 * the ones named explicitly are tightened or pinned on purpose.
 */
function setupSecurityHeaders(app: App) {
  app.use(
    helmet({
      // Default CSP (default-src 'self' + friends) — strict enough for a
      // JSON API and still compatible with the Swagger UI at /docs, which
      // loads only same-origin scripts/styles.
      contentSecurityPolicy: true,
      // X-Frame-Options: DENY — an API has no business inside a frame.
      frameguard: { action: 'deny' },
      // X-Content-Type-Options: nosniff (helmet default, pinned here).
      noSniff: true,
      // HSTS: one year, subdomains included. Browsers ignore it over plain
      // http, so it is harmless in dev and active the moment TLS fronts it.
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
    }),
  );
}

/**
 * Cross-origin access is opt-in per origin via CORS_ORIGINS (comma
 * separated). No entries -> no CORS headers at all (fail closed); a
 * wildcard is impossible by construction. The Next.js dashboard is not
 * affected either way — it talks to this API server-side through its
 * proxy routes, never from the browser.
 */
function setupCors(app: App) {
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'X-Admin-Key', 'X-Request-Id'],
    // Let browser clients read the quota state and correlation id.
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'X-Request-Id',
    ],
    maxAge: 600,
  });
}

function setupSwagger(app: App) {
  const config = new DocumentBuilder()
    .setTitle('rate-guard')
    .setDescription(
      'Multi-tenant rate-limiting API gateway. Tenant traffic authenticates ' +
        'with x-api-key and is throttled by an atomic Redis sliding window; ' +
        'the admin API (x-admin-key) manages tenants, quotas and live stats.',
    )
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: 'Tenant API key (returned once when creating a tenant).',
      },
      'api-key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-admin-key',
        in: 'header',
        description: 'Admin API key (ADMIN_API_KEY environment variable).',
      },
      'admin-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'rate-guard API docs',
    jsonDocumentUrl: 'docs-json',
  });
}

async function bootstrap() {
  // Buffer until pino takes over so even bootstrap logs come out structured.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  setupGracefulShutdown(app);
  setupSecurityHeaders(app);
  setupCors(app);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  setupSwagger(app);
  // 3001 keeps the native default clear of the Next.js dashboard on 3000.
  // In Docker the container port is pinned to 3000 by compose regardless.
  const port = process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(`📚 API docs available at: http://localhost:${port}/docs`);
}

bootstrap();
