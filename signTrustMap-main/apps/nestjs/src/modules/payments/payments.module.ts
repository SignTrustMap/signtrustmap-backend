import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentOrder } from '../../entities/payment-order.entity';
import { PaymentCallback } from '../../entities/payment-callback.entity';
import { TopupPackage } from '../../entities/topup-package.entity';
import { Wallet } from '../../entities/wallet.entity';
import { CreditTransaction } from '../../entities/credit-transaction.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentOrder, PaymentCallback, TopupPackage, Wallet, CreditTransaction])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
