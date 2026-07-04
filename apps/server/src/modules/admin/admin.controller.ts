import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/decorator/auth.decorator';
import { AdminGuard } from './guard/admin.guard';
import { AdminService, type QuotaUpdateDto } from './admin.service';

/**
 * @Public() opts out of the tenant AuthGuard (admins are not tenants) and
 * with it the rate limiter; AdminGuard then requires the separate admin key.
 */
@Public()
@UseGuards(AdminGuard)
@Controller('admin/tenants')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listTenants();
  }

  @Post()
  create(@Body() body: { name?: unknown }) {
    return this.admin.createTenant(body?.name);
  }

  @Get(':id/quota')
  getQuota(@Param('id') id: string) {
    return this.admin.getQuota(id);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.admin.getStats(id);
  }

  @Put(':id/quota')
  updateQuota(@Param('id') id: string, @Body() body: QuotaUpdateDto) {
    return this.admin.updateQuota(id, body);
  }
}
