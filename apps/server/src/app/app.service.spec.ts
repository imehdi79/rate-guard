import { Test } from '@nestjs/testing';
import { AppService } from './app.service';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

describe('AppService', () => {
  let service: AppService;

  beforeAll(async () => {
    const app = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: DatabaseService, useValue: { isAlive: jest.fn() } },
        { provide: RedisService, useValue: { isAlive: jest.fn() } },
      ],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  describe('getData', () => {
    it('should return "Hello API"', () => {
      expect(service.getData()).toEqual({ message: 'Hello API' });
    });
  });
});
