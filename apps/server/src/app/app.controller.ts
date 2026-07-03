import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from '../modules/auth/decorator/auth.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @Public()
  @Get('public')
  getPublicData() {
    return { message: 'This is public data' };
  }
}
