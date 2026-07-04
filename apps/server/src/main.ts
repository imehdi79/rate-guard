/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app/app.module';

function setupSwagger(app: Awaited<ReturnType<typeof NestFactory.create>>) {
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
