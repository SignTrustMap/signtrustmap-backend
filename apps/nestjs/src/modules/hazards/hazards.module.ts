import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadHazardEvent } from './infrastructure/persistence/road-hazard-event.entity';
import { HazardConfirmation } from './infrastructure/persistence/hazard-confirmation.entity';
import { HazardEvidence } from './infrastructure/persistence/hazard-evidence.entity';
import { HazardsService } from './application/hazards.service';
import { HazardsController } from './presentation/hazards.controller';
import { WalletModule } from '../wallet/wallet.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MinioModule } from '../../integrations/minio/minio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoadHazardEvent, HazardConfirmation, HazardEvidence]),
    WalletModule,
    DailyTasksModule,
    NotificationsModule,
    MinioModule,
  ],
  controllers: [HazardsController],
  providers: [HazardsService],
  exports: [HazardsService],
})
export class HazardsModule {}
