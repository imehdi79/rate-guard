import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}
  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  async isAlive(): Promise<{ message: string }> {
    // is database alive
    const isDbAlive = await this.db.isAlive();

    return { message: isDbAlive ? 'Alive' : 'Not Alive' };
  }
}
