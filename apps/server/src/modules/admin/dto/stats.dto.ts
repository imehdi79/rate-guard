import { ApiProperty } from '@nestjs/swagger';

export class StatsQuotaDto {
  @ApiProperty({
    description: 'Maximum number of requests allowed inside one window.',
    example: 100,
    type: 'integer',
  })
  max_requests!: number;

  @ApiProperty({
    description: 'Sliding window length in seconds.',
    example: 60,
    type: 'integer',
  })
  window_seconds!: number;

  @ApiProperty({
    description: 'false when the tenant runs on the built-in defaults.',
    example: true,
  })
  configured!: boolean;
}

export class StatsUsageDto {
  @ApiProperty({
    description:
      'Requests currently inside the sliding window. Read directly from ' +
      'the rate limiter state in Redis; reading it never consumes quota.',
    example: 42,
    type: 'integer',
  })
  current!: number;

  @ApiProperty({
    description: 'Requests still available inside the current window.',
    example: 58,
    type: 'integer',
  })
  remaining!: number;
}

export class RecentViolationDto {
  @ApiProperty({
    description: 'Violation log row id.',
    example: 'b6c66a54-44c2-46a7-9fe1-f2daebabe741',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description:
      'Correlation id of the denied request — matches the X-Request-Id ' +
      'response header and the request\'s log lines.',
    example: '8e6e6348-27c2-467a-94c2-e70b523699e1',
  })
  request_id!: string;

  @ApiProperty({ description: 'Path that was denied.', example: '/api' })
  path!: string;

  @ApiProperty({
    description: 'When the request was denied.',
    example: '2026-07-04T16:52:03.341Z',
    format: 'date-time',
  })
  created_at!: Date;
}

export class StatsViolationsDto {
  @ApiProperty({
    description: 'Number of requests denied with 429 in the last 24 hours.',
    example: 3,
    type: 'integer',
  })
  last_24h!: number;

  @ApiProperty({
    description: 'Most recent violations, newest first (max 20).',
    type: RecentViolationDto,
    isArray: true,
  })
  recent!: RecentViolationDto[];
}

export class TenantStatsDto {
  @ApiProperty({
    description: 'Tenant id.',
    example: '86e79239-80fb-4c7c-830c-eabd522d58be',
    format: 'uuid',
  })
  tenantId!: string;

  @ApiProperty({ description: 'Tenant name.', example: 'acme-corp' })
  name!: string;

  @ApiProperty({ description: 'Effective quota.', type: StatsQuotaDto })
  quota!: StatsQuotaDto;

  @ApiProperty({
    description: 'Live sliding-window usage.',
    type: StatsUsageDto,
  })
  usage!: StatsUsageDto;

  @ApiProperty({
    description: 'Violation history.',
    type: StatsViolationsDto,
  })
  violations!: StatsViolationsDto;
}
