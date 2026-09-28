import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RewardRule } from './infrastructure/persistence/reward-rule.entity';
import { RewardEngineService } from './application/reward-engine.service';
import { RewardsController } from './presentation/rewards.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RewardRule])],
  controllers: [RewardsController],
  providers: [RewardEngineService],
  exports: [RewardEngineService],
})
export class RewardsModule {}
