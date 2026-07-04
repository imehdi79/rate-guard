import { Injectable } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService extends PrismaClient {
  constructor(configService: ConfigService) {
    // Hand the adapter a config, not a pg.Pool. The adapter recognizes an
    // external pool via `instanceof pg.Pool` against its own pg import —
    // in the webpack bundle that can be a different module copy than ours,
    // in which case the pool would be silently misread as a config object
    // (losing the connection string and dialing the default port 5432).
    // With a plain config the adapter owns the pool and none of that
    // module-identity fragility applies.
    const adapter = new PrismaPg({
      connectionString: configService.get('DATABASE_URL'),
    });

    super({ adapter });
  }

  async isAlive(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error('Database connection error:', error);
      return false;
    }
  }
}
