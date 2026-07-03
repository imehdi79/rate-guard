import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}
  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async isAlive(): Promise<{ message: string }> {
    // is database alive
    const isDbAlive = await this.db.isAlive();
    this.logger.debug(`Database is alive: ${isDbAlive}`);
    const isRedisAlive = await this.redis.isAlive();
    this.logger.debug(`Redis is alive: ${isRedisAlive}`);

    return { message: isDbAlive && isRedisAlive ? 'Alive' : 'Not Alive' };
  }
}
