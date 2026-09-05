import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadSession } from '../../entities/upload-session.entity';
import { UploadChunk } from '../../entities/upload-chunk.entity';
import { SurveySubmission } from '../../entities/survey-submission.entity';
import { SurveyService } from './survey.service';
import { SurveyController } from './survey.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UploadSession, UploadChunk, SurveySubmission]),
    WalletModule,
    NotificationsModule,
  ],
  controllers: [SurveyController],
  providers: [SurveyService],
  exports: [SurveyService],
})
export class SurveyModule {}
