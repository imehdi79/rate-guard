import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      },
    },
    RedisService,
  ],
  exports: ['REDIS_CLIENT', RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Runs during app.close() after in-flight requests finished. quit()
   * waits for pending replies before closing the socket; if the server is
   * unreachable the hard close keeps shutdown from hanging past the
   * process-level deadline.
   */
  async onApplicationShutdown() {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
