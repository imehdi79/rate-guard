import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimiterService } from './rate-limiter.service';
import { RateLimitGuard } from './guard/rate-limit.guard';

@Global()
@Module({
  providers: [
    RateLimiterService,
    // Global by default: every authenticated route is rate limited. The
    // guard skips @Public() routes and requests without a tenant. AuthGuard
    // registers first (AuthModule precedes this module in AppModule), so
    // req.tenant is already attached when this guard runs.
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    // Also provided/exported standalone so it stays composable: drop the
    // APP_GUARD binding above and apply @UseGuards(RateLimitGuard) per
    // route or controller instead. Do not use both at once — each pass
    // through the guard consumes one request from the quota.
    RateLimitGuard,
  ],
  exports: [RateLimiterService, RateLimitGuard],
})
export class RateLimiterModule {}
