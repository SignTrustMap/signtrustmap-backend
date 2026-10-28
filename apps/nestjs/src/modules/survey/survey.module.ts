import { CameraCalibrationProfile } from './infrastructure/persistence/camera-calibration-profile.entity';
import { CameraProfileService } from './application/camera-profile.service';
import { CameraProfileController } from './presentation/camera-profile.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SurveyService } from './application/survey.service';
import { BatchSurveyService } from './application/batch-survey.service';
import { SubmissionMediaFile } from './infrastructure/persistence/submission-media-file.entity';
import { SurveySubmission } from './infrastructure/persistence/survey-submission.entity';
import { BatchSubmission } from './infrastructure/persistence/batch-submission.entity';
import { UnverifiedSignCandidate } from './infrastructure/persistence/unverified-sign-candidate.entity';
import { SurveyorProfile } from './infrastructure/persistence/surveyor-profile.entity';
import { SubmissionStatusHistory } from './infrastructure/persistence/submission-status-history.entity';
import { CandidateGeoEstimation } from './infrastructure/persistence/candidate-geo-estimation.entity';
import { UploadChunk } from './infrastructure/persistence/upload-chunk.entity';
import { UploadSession } from './infrastructure/persistence/upload-session.entity';
import { SurveyController } from './presentation/survey.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RewardsModule } from '../rewards/rewards.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UploadSession,
      UploadChunk,
      SurveySubmission,
      BatchSubmission,
      SubmissionMediaFile,
      UnverifiedSignCandidate,
      CameraCalibrationProfile,
      SurveyorProfile,
      SubmissionStatusHistory,
      CandidateGeoEstimation,
    ]),
    WalletModule,
    NotificationsModule,
    RewardsModule,
    DailyTasksModule,
  ],
  controllers: [SurveyController, CameraProfileController],
  providers: [SurveyService, BatchSurveyService, CameraProfileService],
  exports: [SurveyService, BatchSurveyService, CameraProfileService],
})
export class SurveyModule {}
