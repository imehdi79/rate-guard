import { ApiProperty } from '@nestjs/swagger';

export class UpdateQuotaDto {
  @ApiProperty({
    description: 'Maximum number of requests allowed inside one window.',
    example: 100,
    minimum: 1,
    type: 'integer',
  })
  max_requests!: number;

  @ApiProperty({
    description: 'Sliding window length in seconds.',
    example: 60,
    minimum: 1,
    type: 'integer',
  })
  window_seconds!: number;
}
