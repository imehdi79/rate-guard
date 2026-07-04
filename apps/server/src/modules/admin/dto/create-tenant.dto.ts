import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({
    description: 'Unique tenant name. Leading/trailing whitespace is trimmed.',
    example: 'acme-corp',
    minLength: 1,
  })
  name!: string;
}
