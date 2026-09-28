import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from './application/wallet.service';
import { CreditTransaction } from './infrastructure/persistence/credit-transaction.entity';
import { PaymentMethod } from './infrastructure/persistence/payment-method.entity';
import { Wallet } from './infrastructure/persistence/wallet.entity';
import { WalletController } from './presentation/wallet.controller';
import { PaymentOrder } from '../payments/infrastructure/persistence/payment-order.entity';
import { TopupPackage } from '../payments/infrastructure/persistence/topup-package.entity';

import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, CreditTransaction, TopupPackage, PaymentOrder, PaymentMethod]),
    RewardsModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
