import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MlopsController } from './mlops.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [AdminController, MlopsController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
