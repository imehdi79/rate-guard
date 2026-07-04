import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PUBLIC_KEY } from '../decorator/auth.decorator';
import { Reflector } from '@nestjs/core';
import { TenantConfigService } from '../tenant-config.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Check if the route is marked as public using the PUBLIC_KEY metadata
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();

    // compare tenant api key with the one in the request header
    const header = req.headers['x-api-key'];
    const apiKey = Array.isArray(header) ? header[0] : header;
    if (apiKey) {
      // Redis-cached lookup; includes the quota config so the rate limit
      // guard needs no extra round trip.
      const tenant = await this.tenants.findByApiKey(apiKey);
      if (!tenant) {
        return false; // Deny access if the API key is invalid
      }

      req.tenant = tenant; // Attach the tenant record to the request object for further use
      return true; // Allow access if the API key is valid
    }

    return false; // Deny access if no API key was provided
  }
}
