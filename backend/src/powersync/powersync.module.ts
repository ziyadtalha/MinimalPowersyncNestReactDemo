import { Module } from '@nestjs/common';
import { PowersyncController } from './powersync.controller';

@Module({
  controllers: [PowersyncController],
})
export class PowersyncModule {}
