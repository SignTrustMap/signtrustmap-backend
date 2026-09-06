import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurveyService } from './application/survey.service';
import { SubmissionMediaFile } from './infrastructure/persistence/submission-media-file.entity';
import { SurveySubmission } from './infrastructure/persistence/survey-submission.entity';
import { UnverifiedSignCandidate } from './infrastructure/persistence/unverified-sign-candidate.entity';
import { UploadChunk } from './infrastructure/persistence/upload-chunk.entity';
import { UploadSession } from './infrastructure/persistence/upload-session.entity';
import { SurveyController } from './presentation/survey.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UploadSession,
      UploadChunk,
      SurveySubmission,
      SubmissionMediaFile,
      UnverifiedSignCandidate,
    ]),
    WalletModule,
    NotificationsModule,
  ],
  controllers: [SurveyController],
  providers: [SurveyService],
  exports: [SurveyService],
})
export class SurveyModule {}
