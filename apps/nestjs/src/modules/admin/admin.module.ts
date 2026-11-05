import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MlopsController } from './mlops.controller';
import { WalletModule } from '../wallet/wallet.module';
import { User } from '../auth/infrastructure/persistence/user.entity';
import { UserRole } from '../auth/infrastructure/persistence/user-role.entity';
import { Role } from '../auth/infrastructure/persistence/role.entity';
import { AuditLog } from './audit-log.entity';
import { AiModelVersion } from './ai-model-version.entity';
import { ModelTrainingJob } from './model-training-job.entity';
import { UserStatusHistory } from './user-status-history.entity';
import { ConsensusConfig } from '../consensus/infrastructure/persistence/consensus-config.entity';
import { FreshnessRule } from '../revalidation/infrastructure/persistence/freshness-rule.entity';
import { RewardRule } from '../rewards/infrastructure/persistence/reward-rule.entity';
import { SystemFeatureFlag } from './system-feature-flag.entity';
import { SystemSwitchModule } from './system-switch.module';
import { SystemSwitchService } from './system-switch.service';

@Module({
  imports: [
    WalletModule,
    SystemSwitchModule,
    TypeOrmModule.forFeature([
      User,
      UserRole,
      Role,
      AuditLog,
      AiModelVersion,
      ModelTrainingJob,
      UserStatusHistory,
      ConsensusConfig,
      FreshnessRule,
      RewardRule,
      SystemFeatureFlag,
    ]),
  ],
  controllers: [AdminController, MlopsController],
  providers: [AdminService],
  exports: [AdminService, SystemSwitchModule],
})
export class AdminModule {}
