import { CameraCalibrationProfile } from './infrastructure/persistence/camera-calibration-profile.entity';
import { CameraProfileService } from './application/camera-profile.service';
import { CameraProfileController } from './presentation/camera-profile.controller';
import { Module } from '@nestjs/common';
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
      CameraCalibrationProfile,
    ]),
    WalletModule,
    NotificationsModule,
  ],
  controllers: [SurveyController, CameraProfileController],
  providers: [SurveyService, CameraProfileService],
  exports: [SurveyService, CameraProfileService],
})
export class SurveyModule {}
