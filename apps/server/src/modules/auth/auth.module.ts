import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './guard/auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { TenantConfigService } from './tenant-config.service';

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    TenantConfigService,
  ],
  exports: [TenantConfigService],
})
export class AuthModule {}
