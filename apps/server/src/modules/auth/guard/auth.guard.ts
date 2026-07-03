import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PUBLIC_KEY } from '../decorator/auth.decorator';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Check if the route is marked as public using the PUBLIC_KEY metadata
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();

    return false; // Deny access if the route is not public and no authentication logic is implemented
  }
}
