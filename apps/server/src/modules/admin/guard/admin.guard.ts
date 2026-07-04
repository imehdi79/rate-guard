import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Protects the admin API with a dedicated key (ADMIN_API_KEY env), entirely
 * separate from tenant api keys: leaking a tenant key must never grant
 * admin access, and rotating the admin key must not touch tenants.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const adminKey = this.config.get<string>('ADMIN_API_KEY');
    if (!adminKey) {
      // Fail closed: no configured key means no admin surface at all.
      this.logger.error('ADMIN_API_KEY is not set; denying admin request');
      return false;
    }

    const req = ctx.switchToHttp().getRequest();
    const header = req.headers['x-admin-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (typeof provided !== 'string' || provided.length === 0) {
      return false;
    }

    // Constant-time comparison; a plain === would leak key prefixes
    // through response timing.
    const a = Buffer.from(provided);
    const b = Buffer.from(adminKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
