import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorator/auth.decorator';
import { AdminGuard } from './guard/admin.guard';
import { AdminService } from './admin.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { CreatedTenantDto, TenantDto } from './dto/tenant.dto';
import { QuotaResponseDto } from './dto/quota.dto';
import { TenantStatsDto } from './dto/stats.dto';

const TENANT_ID_PARAM = {
  name: 'id',
  description: 'Tenant id (uuid).',
  example: '86e79239-80fb-4c7c-830c-eabd522d58be',
} as const;

/**
 * @Public() opts out of the tenant AuthGuard (admins are not tenants) and
 * with it the rate limiter; AdminGuard then requires the separate admin key.
 */
@ApiTags('admin')
@ApiSecurity('admin-key')
@ApiForbiddenResponse({
  description: 'Missing or invalid x-admin-key header.',
})
@Public()
@UseGuards(AdminGuard)
@Controller('admin/tenants')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List tenants',
    description:
      'All tenants, newest first. API keys are never included — they are ' +
      'returned exactly once, by the create endpoint.',
  })
  @ApiOkResponse({ type: TenantDto, isArray: true })
  list() {
    return this.admin.listTenants();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a tenant',
    description:
      'Generates the tenant API key. This response is the only place the ' +
      'key is ever exposed.',
  })
  @ApiCreatedResponse({ type: CreatedTenantDto })
  @ApiBadRequestResponse({ description: 'name is missing or blank.' })
  @ApiConflictResponse({ description: 'A tenant with this name exists.' })
  create(@Body() body: CreateTenantDto) {
    return this.admin.createTenant(body?.name);
  }

  @Get(':id/quota')
  @ApiOperation({
    summary: 'Get a tenant quota',
    description:
      'Effective quota; `configured: false` means the built-in defaults.',
  })
  @ApiParam(TENANT_ID_PARAM)
  @ApiOkResponse({ type: QuotaResponseDto })
  @ApiNotFoundResponse({ description: 'Unknown tenant id.' })
  getQuota(@Param('id') id: string) {
    return this.admin.getQuota(id);
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'Get live tenant stats',
    description:
      'Live sliding-window usage (read from the rate limiter state, never ' +
      'consuming quota), the 24h violation count and the most recent ' +
      'violations. The dashboard polls this endpoint.',
  })
  @ApiParam(TENANT_ID_PARAM)
  @ApiOkResponse({ type: TenantStatsDto })
  @ApiNotFoundResponse({ description: 'Unknown tenant id.' })
  getStats(@Param('id') id: string) {
    return this.admin.getStats(id);
  }

  @Put(':id/quota')
  @ApiOperation({
    summary: 'Update a tenant quota',
    description:
      'Upserts the quota and eagerly invalidates the Redis-cached tenant ' +
      'config, so the new limit is enforced on the very next request.',
  })
  @ApiParam(TENANT_ID_PARAM)
  @ApiOkResponse({ type: QuotaResponseDto })
  @ApiBadRequestResponse({
    description: 'max_requests or window_seconds is not a positive integer.',
  })
  @ApiNotFoundResponse({ description: 'Unknown tenant id.' })
  updateQuota(@Param('id') id: string, @Body() body: UpdateQuotaDto) {
    return this.admin.updateQuota(id, body);
  }
}
