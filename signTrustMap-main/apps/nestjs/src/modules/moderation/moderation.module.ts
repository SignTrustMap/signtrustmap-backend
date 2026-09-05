import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationCase } from '../../entities/moderation-case.entity';
import { ModerationAction } from '../../entities/moderation-action.entity';
import { MissingSignTypeReport } from '../../entities/missing-sign-type-report.entity';
import { SignCategory } from '../../entities/sign-category.entity';
import { TrafficSignType } from '../../entities/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../../entities/unverified-sign-candidate.entity';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [TypeOrmModule.forFeature([ModerationCase, ModerationAction, MissingSignTypeReport, SignCategory, TrafficSignType, UnverifiedSignCandidate]), NotificationsModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
