import { Injectable } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService extends PrismaClient {
  constructor(private readonly configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.get('DATABASE_URL'),
    });

    const adapter = new PrismaPg(pool);

    super({ adapter });
  }
}
