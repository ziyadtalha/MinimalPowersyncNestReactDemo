import { Module } from '@nestjs/common';
import { PowerSyncController } from './powersync.controller';
import { PowerSyncService } from './powersync.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PowerSyncController],
  providers: [PowerSyncService],
})
export class PowerSyncModule {}
