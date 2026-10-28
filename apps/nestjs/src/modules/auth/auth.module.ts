import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './application/auth.service';
import { GoogleStrategy } from './infrastructure/google.strategy';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { Role } from './infrastructure/persistence/role.entity';
import { UserRole } from './infrastructure/persistence/user-role.entity';
import { User } from './infrastructure/persistence/user.entity';
import { DriverProfile } from './infrastructure/persistence/driver-profile.entity';
import { OAuthAccount } from './infrastructure/persistence/oauth-account.entity';
import { AuthOtpToken } from './infrastructure/persistence/auth-otp-token.entity';
import { SurveyorProfile } from '../survey/infrastructure/persistence/surveyor-profile.entity';
import { AuthController } from './presentation/auth.controller';
import { Wallet } from '../wallet/infrastructure/persistence/wallet.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') || config.get<string>('JWT_SECRET') || 'dev_jwt_secret_change_me',
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn') || config.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
    }),
    TypeOrmModule.forFeature([
      User,
      UserRole,
      Role,
      Wallet,
      DriverProfile,
      OAuthAccount,
      AuthOtpToken,
      SurveyorProfile,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
