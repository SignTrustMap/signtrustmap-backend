import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './application/wallet.service';
import { CreditTransaction } from './infrastructure/persistence/credit-transaction.entity';
import { PaymentMethod } from './infrastructure/persistence/payment-method.entity';
import { Wallet } from './infrastructure/persistence/wallet.entity';
import { WalletController } from './presentation/wallet.controller';
import { PaymentOrder } from '../payments/infrastructure/persistence/payment-order.entity';
import { TopupPackage } from '../payments/infrastructure/persistence/topup-package.entity';
import { AuditLog } from '../admin/audit-log.entity';
import { RewardRule } from '../rewards/infrastructure/persistence/reward-rule.entity';
import { CreditRule } from '../rewards/infrastructure/persistence/credit-rule.entity';

import { RewardsModule } from '../rewards/rewards.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      CreditTransaction,
      TopupPackage,
      PaymentOrder,
      PaymentMethod,
      AuditLog,
      RewardRule,
      CreditRule,
    ]),
    RewardsModule,
    PaymentsModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
