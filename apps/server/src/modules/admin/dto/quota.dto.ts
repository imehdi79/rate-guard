import { ApiProperty } from '@nestjs/swagger';

export class QuotaResponseDto {
  @ApiProperty({
    description: 'Tenant id the quota applies to.',
    example: '86e79239-80fb-4c7c-830c-eabd522d58be',
    format: 'uuid',
  })
  tenantId!: string;

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
    description:
      'true when the tenant has an explicit quota config; false when the ' +
      'values above are the built-in defaults.',
    example: true,
  })
  configured!: boolean;
}
