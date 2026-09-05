import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../../entities/wallet.entity';
import { CreditTransaction } from '../../entities/credit-transaction.entity';
import { TopupPackage } from '../../entities/topup-package.entity';
import { PaymentOrder } from '../../entities/payment-order.entity';
import { PaymentMethod } from '../../entities/payment-method.entity';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, CreditTransaction, TopupPackage, PaymentOrder, PaymentMethod])],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
