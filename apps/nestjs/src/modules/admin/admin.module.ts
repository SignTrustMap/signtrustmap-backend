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

@Module({
  imports: [
    WalletModule,
    TypeOrmModule.forFeature([User, UserRole, Role, AuditLog]),
  ],
  controllers: [AdminController, MlopsController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
