import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsensusService } from './application/consensus.service';
import { ConsensusConfig } from './infrastructure/persistence/consensus-config.entity';
import { ConsensusLog } from './infrastructure/persistence/consensus-log.entity';
import { CandidateReview } from '../reviews/infrastructure/persistence/candidate-review.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConsensusConfig, ConsensusLog, UnverifiedSignCandidate, CandidateReview]),
    WalletModule,
    NotificationsModule,
  ],
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
