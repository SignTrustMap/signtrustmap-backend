import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './application/payments.service';
import { PaymentCallback } from './infrastructure/persistence/payment-callback.entity';
import { PaymentOrder } from './infrastructure/persistence/payment-order.entity';
import { TopupPackage } from './infrastructure/persistence/topup-package.entity';
import { PaymentsController } from './presentation/payments.controller';
import { CreditTransaction } from '../wallet/infrastructure/persistence/credit-transaction.entity';
import { Wallet } from '../wallet/infrastructure/persistence/wallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentOrder, PaymentCallback, TopupPackage, Wallet, CreditTransaction])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
