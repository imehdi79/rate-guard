import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '../modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { DatabaseModule } from '../database/database.module';
import { RateLimiterModule } from '../modules/rate-limiter/rate-limiter.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    DatabaseModule,
    RedisModule,
    RateLimiterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
