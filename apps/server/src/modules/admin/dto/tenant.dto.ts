import { ApiProperty } from '@nestjs/swagger';

export class TenantQuotaConfigDto {
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
}

export class TenantDto {
  @ApiProperty({
    description: 'Tenant id.',
    example: '86e79239-80fb-4c7c-830c-eabd522d58be',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Unique tenant name.', example: 'acme-corp' })
  name!: string;

  @ApiProperty({
    description: 'Creation timestamp.',
    example: '2026-07-04T16:52:02.781Z',
    format: 'date-time',
  })
  created_at!: Date;

  @ApiProperty({
    description:
      'Explicit quota config, or null when the tenant runs on defaults.',
    type: TenantQuotaConfigDto,
    nullable: true,
  })
  quotaConfigs!: TenantQuotaConfigDto | null;
}

export class CreatedTenantDto {
  @ApiProperty({
    description: 'Tenant id.',
    example: '86e79239-80fb-4c7c-830c-eabd522d58be',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Unique tenant name.', example: 'acme-corp' })
  name!: string;

  @ApiProperty({
    description:
      'The tenant API key (x-api-key header). Returned exactly once, here — ' +
      'no other endpoint ever exposes it. Store it now.',
    example: 'rk_36094fb8b7e7e3a02a44714664165887f32ef053dec66a50',
  })
  api_key!: string;

  @ApiProperty({
    description: 'Creation timestamp.',
    example: '2026-07-04T16:52:02.781Z',
    format: 'date-time',
  })
  created_at!: Date;
}
