import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from '../modules/auth/decorator/auth.decorator';

const RATE_LIMIT_HEADERS = {
  'X-RateLimit-Limit': {
    description: 'Max requests allowed inside the window.',
    schema: { type: 'integer', example: 100 },
  },
  'X-RateLimit-Remaining': {
    description: 'Requests left inside the current window.',
    schema: { type: 'integer', example: 99 },
  },
  'X-RateLimit-Reset': {
    description: 'Unix seconds when a slot frees up.',
    schema: { type: 'integer', example: 1_780_000_060 },
  },
};

@ApiTags('gateway')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Rate-limited sample endpoint',
    description:
      'Authenticates the tenant via x-api-key and consumes one request of ' +
      'its sliding-window quota — the endpoint to hammer when trying out ' +
      'the rate limiter.',
  })
  @ApiOkResponse({
    description: 'Request allowed; quota headers describe the window.',
    schema: { example: { message: 'Hello API' } },
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiForbiddenResponse({
    description: 'Missing or invalid x-api-key header.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Quota exhausted. Denied requests do not consume quota; retry after ' +
      'Retry-After seconds. The violation is logged and joinable with the ' +
      'X-Request-Id response header.',
    schema: {
      example: {
        statusCode: 429,
        message: 'Rate limit exceeded',
        retryAfter: 7,
      },
    },
    headers: {
      ...RATE_LIMIT_HEADERS,
      'Retry-After': {
        description: 'Seconds until a slot frees up.',
        schema: { type: 'integer', example: 7 },
      },
    },
  })
  getData() {
    return this.appService.getData();
  }

  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Public; reports whether Postgres and Redis are reachable.',
  })
  @ApiOkResponse({
    schema: { example: { message: 'Alive' } },
  })
  isAlive() {
    return this.appService.isAlive();
  }
}
