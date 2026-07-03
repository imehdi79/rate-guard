import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PUBLIC_KEY } from '../decorator/auth.decorator';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
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
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const check = await this.db.tenant.findFirst({
        where: {
          api_key: apiKey,
        },
      });
      if (!check) {
        return false; // Deny access if the API key is invalid
      }

      req.tenant = check; // Attach the tenant record to the request object for further use
      return true; // Allow access if the API key is valid
    }

    return false; // Deny access if no API key was provided
  }
}
