import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsensusConfig } from '../../entities/consensus-config.entity';
import { ConsensusLog } from '../../entities/consensus-log.entity';
import { UnverifiedSignCandidate } from '../../entities/unverified-sign-candidate.entity';
import { CandidateReview } from '../../entities/candidate-review.entity';
import { ConsensusService } from './consensus.service';
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
