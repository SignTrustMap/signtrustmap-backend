import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { User, UserStatus } from '../infrastructure/persistence/user.entity';
import { UserRole } from '../infrastructure/persistence/user-role.entity';
import { Role } from '../infrastructure/persistence/role.entity';
import { Wallet } from '../../wallet/infrastructure/persistence/wallet.entity';
import { DriverProfile } from '../infrastructure/persistence/driver-profile.entity';
import { SurveyorProfile } from '../../survey/infrastructure/persistence/surveyor-profile.entity';
import { ReviewerProfile } from '../../reviews/infrastructure/persistence/reviewer-profile.entity';
import { OAuthAccount } from '../infrastructure/persistence/oauth-account.entity';
import { AuthOtpToken } from '../infrastructure/persistence/auth-otp-token.entity';
import { RegisterDto, LoginDto } from '../presentation/dto/auth.dto';
import { JwtPayload } from '../domain/auth.types';

type GoogleUserProfile = {
  email: string;
  fullName: string;
  avatarUrl: string | null;
  providerUserId: string;
  emailVerified: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    @Optional() private readonly configService?: ConfigService,
    @Optional() @InjectRepository(DriverProfile) private readonly driverProfileRepo?: Repository<DriverProfile>,
    @Optional() @InjectRepository(SurveyorProfile) private readonly surveyorProfileRepo?: Repository<SurveyorProfile>,
    @Optional() @InjectRepository(ReviewerProfile) private readonly reviewerProfileRepo?: Repository<ReviewerProfile>,
    @Optional() @InjectRepository(OAuthAccount) private readonly oauthAccountRepo?: Repository<OAuthAccount>,
    @Optional() @InjectRepository(AuthOtpToken) private readonly authOtpTokenRepo?: Repository<AuthOtpToken>,
  ) {}

  private async getRolesForUser(userId: string): Promise<string[]> {
    const rows = await this.userRoleRepo.find({ where: { userId, isActive: true }, relations: ['role'] });
    return rows.map((r) => r.role.code);
  }

  private signToken(user: User, roles: string[]): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, roles };
    return this.jwtService.sign(payload);
  }

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const targetRoleCode = (dto.role ? dto.role.toUpperCase() : 'DRIVER');
    const ALLOWED_ROLES = ['SURVEYOR', 'DRIVER', 'REVIEWER'];
    if (!ALLOWED_ROLES.includes(targetRoleCode)) {
      throw new BadRequestException(`Role ${dto.role} is not allowed for self-registration`);
    }

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, { email: dto.email, passwordHash, fullName: dto.fullName, phone: dto.phone || null, status: UserStatus.ACTIVE });
      const savedUser = await manager.save(user);
      const role = await manager.findOne(Role, { where: { code: targetRoleCode } });
      if (role) await manager.save(manager.create(UserRole, { userId: savedUser.id, roleId: role.id, isActive: true }));
      await manager.save(manager.create(Wallet, { userId: savedUser.id, balance: '0' }));

      // Initialize corresponding role profile
      if (targetRoleCode === 'DRIVER') {
        if (typeof manager?.getRepository === 'function') {
          const repo = manager.getRepository(DriverProfile);
          await repo
            .createQueryBuilder()
            .insert()
            .into(DriverProfile)
            .values({ userId: savedUser.id })
            .orIgnore()
            .execute();
        } else {
          await manager.query(`INSERT INTO driver_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [savedUser.id]);
        }
      } else if (targetRoleCode === 'REVIEWER') {
        if (typeof manager?.getRepository === 'function') {
          const repo = manager.getRepository(ReviewerProfile);
          await repo
            .createQueryBuilder()
            .insert()
            .into(ReviewerProfile)
            .values({ userId: savedUser.id, reliabilityScore: 0.5 })
            .orIgnore()
            .execute();
        } else {
          await manager.query(`INSERT INTO reviewer_profiles (user_id, reliability_score) VALUES ($1, 0.5) ON CONFLICT (user_id) DO NOTHING`, [savedUser.id]);
        }
      } else if (targetRoleCode === 'SURVEYOR') {
        if (typeof manager?.getRepository === 'function') {
          const repo = manager.getRepository(SurveyorProfile);
          await repo
            .createQueryBuilder()
            .insert()
            .into(SurveyorProfile)
            .values({ userId: savedUser.id })
            .orIgnore()
            .execute();
        } else {
          await manager.query(`INSERT INTO surveyor_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [savedUser.id]);
        }
      }

      const roles = role ? [role.code] : [];
      return { user: { id: savedUser.id, email: savedUser.email, fullName: savedUser.fullName, roles }, accessToken: this.signToken(savedUser, roles) };
    });
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException(`Account is ${user.status}`);
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const roles = await this.getRolesForUser(user.id);
    return { user: { id: user.id, email: user.email, fullName: user.fullName, roles }, accessToken: this.signToken(user, roles) };
  }

  async googleTokenLogin(token: string) {
    const clientId = this.configService?.get<string>('jwt.googleClientId');
    if (!clientId) throw new UnauthorizedException('Google login is not configured');
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid or expired Google token');
    }
    if (!payload?.email || !payload.sub) throw new UnauthorizedException('Google token contains no stable identity');
    if (payload.email_verified !== true) throw new UnauthorizedException('Google email is not verified');
    return this.googleLogin({
      email: payload.email,
      fullName: payload.name || payload.given_name || payload.email,
      avatarUrl: payload.picture || null,
      providerUserId: payload.sub,
      emailVerified: true,
    });
  }

  async googleLogin(googleUser: GoogleUserProfile) {
    if (!googleUser.email) throw new BadRequestException('Google profile has no email');
    if (!googleUser.providerUserId) throw new UnauthorizedException('Google profile has no stable identity');
    const provider = 'GOOGLE';
    const oauthRepo = this.oauthAccountRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(OAuthAccount) : null);
    let linkedAccounts: Array<{ user_id: string; userId?: string }> = [];
    if (oauthRepo) {
      const records = await oauthRepo.find({
        where: { provider, providerUserId: googleUser.providerUserId },
        take: 2,
      });
      linkedAccounts = records.map((r) => ({ user_id: r.userId, userId: r.userId }));
    } else {
      linkedAccounts = await this.dataSource.query(
        `SELECT "user_id" FROM "oauth_accounts" WHERE "provider" = $1 AND "provider_user_id" = $2 LIMIT 2`,
        [provider, googleUser.providerUserId],
      );
    }
    if (linkedAccounts.length > 1) throw new ConflictException('Google identity is linked more than once');
    if (linkedAccounts.length === 1) {
      const targetUserId = linkedAccounts[0].userId ?? linkedAccounts[0].user_id;
      const linkedUser = await this.userRepo.findOne({ where: { id: targetUserId } });
      if (!linkedUser) throw new ConflictException('Google identity is linked to a missing account');
      if (linkedUser.status !== UserStatus.ACTIVE) throw new UnauthorizedException(`Account is ${linkedUser.status}`);
      const roles = await this.getRolesForUser(linkedUser.id);
      return { user: { id: linkedUser.id, email: linkedUser.email, fullName: linkedUser.fullName, roles }, accessToken: this.signToken(linkedUser, roles) };
    }
    if (googleUser.emailVerified !== true) throw new UnauthorizedException('Google email is not verified');
    const user = await this.userRepo.findOne({ where: { email: googleUser.email } });
    if (!user) {
      return this.dataSource.transaction(async (manager) => {
        const newUser = manager.create(User, { email: googleUser.email, passwordHash: null, fullName: googleUser.fullName, avatarUrl: googleUser.avatarUrl, status: UserStatus.ACTIVE });
        const saved = await manager.save(newUser);
        try {
          if (typeof manager?.getRepository === 'function') {
            const trxOauthRepo = manager.getRepository(OAuthAccount);
            await trxOauthRepo.insert({
              userId: saved.id,
              provider,
              providerUserId: googleUser.providerUserId,
              email: googleUser.email,
            });
          } else {
            await manager.query(
              `INSERT INTO "oauth_accounts" ("user_id","provider","provider_user_id","email") VALUES ($1,$2,$3,$4)`,
              [saved.id, provider, googleUser.providerUserId, googleUser.email],
            );
          }
        } catch (error: any) {
          if (error?.code === '23505') throw new ConflictException('Google identity is already linked to another account');
          throw error;
        }
        const defaultRole = await manager.findOne(Role, { where: { code: 'DRIVER' } });
        if (defaultRole) await manager.save(manager.create(UserRole, { userId: saved.id, roleId: defaultRole.id, isActive: true }));
        if (defaultRole?.code === 'DRIVER') {
          await manager.query(
            `INSERT INTO driver_profiles (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [saved.id],
         );
        }

        if (defaultRole?.code === 'SURVEYOR') {
          if (typeof manager?.getRepository === 'function') {
           const surveyorRepo = manager.getRepository(SurveyorProfile);
           await surveyorRepo
              .createQueryBuilder()
              .insert()
             .into(SurveyorProfile)
             .values({ userId: saved.id })
              .orIgnore()
              .execute();
          } else {
            await manager.query(
              `INSERT INTO surveyor_profiles (user_id)
               VALUES ($1)
              ON CONFLICT (user_id) DO NOTHING`,
             [saved.id],
            );
          }
        }
        }
        await manager.save(manager.create(Wallet, { userId: saved.id, balance: '0' }));
        const roles = defaultRole ? [defaultRole.code] : [];
        return { user: { id: saved.id, email: saved.email, fullName: saved.fullName, roles }, accessToken: this.signToken(saved, roles) };
      });
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }
    let existingLinks: Array<{ providerUserId: string }> = [];
    if (oauthRepo) {
      const records = await oauthRepo.find({
        where: { userId: user.id, provider },
        take: 2,
      });
      existingLinks = records.map((r) => ({ providerUserId: r.providerUserId }));
    } else {
      existingLinks = await this.dataSource.query(
        `SELECT "provider_user_id" AS "providerUserId" FROM "oauth_accounts" WHERE "user_id" = $1 AND "provider" = $2 LIMIT 2`,
        [user.id, provider],
      );
    }
    if (existingLinks.some((link) => link.providerUserId !== googleUser.providerUserId)) {
      throw new ConflictException('A different Google identity is already linked to this account');
    }
    try {
      if (oauthRepo) {
        await oauthRepo.insert({
          userId: user.id,
          provider,
          providerUserId: googleUser.providerUserId,
          email: googleUser.email,
        });
      } else {
        await this.dataSource.query(
          `INSERT INTO "oauth_accounts" ("user_id","provider","provider_user_id","email") VALUES ($1,$2,$3,$4)`,
          [user.id, provider, googleUser.providerUserId, googleUser.email],
        );
      }
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('Google identity is already linked to another account');
      throw error;
    }
    const exists = await this.walletRepo.findOne({ where: { userId: user.id } });
    if (!exists) await this.walletRepo.save(this.walletRepo.create({ userId: user.id, balance: '0' }));
    const roles = await this.getRolesForUser(user.id);
    return { user: { id: user.id, email: user.email, fullName: user.fullName, roles }, accessToken: this.signToken(user, roles) };
  }

  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const roles = await this.getRolesForUser(userId);
    // Enrich with wallet + profile stats (driver / surveyor / reviewer) when available
    let walletBalance = 0;
    try {
      const wallet = await this.walletRepo.findOne({ where: { userId } });
      if (wallet) {
        walletBalance = Number(wallet.balance);
      } else if (this.dataSource) {
        const wRows: any[] = await this.dataSource.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
        if (wRows.length) walletBalance = Number(wRows[0].balance);
      }
    } catch {}
    const profileStats: any = {};
    try {
      const driverRepo = this.driverProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(DriverProfile) : null);
      if (driverRepo) {
        const dProfile = await driverRepo.findOne({ where: { userId } });
        if (dProfile) profileStats.driver = dProfile;
      } else {
        const dRows: any[] = await this.dataSource.query('SELECT * FROM driver_profiles WHERE user_id=$1', [userId]);
        if (dRows.length) profileStats.driver = dRows[0];
      }
    } catch {}
    try {
      const surveyorRepo = this.surveyorProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(SurveyorProfile) : null);
      if (surveyorRepo) {
        const sProfile = await surveyorRepo.findOne({ where: { userId } });
        if (sProfile) profileStats.surveyor = sProfile;
      } else {
        const sRows: any[] = await this.dataSource.query('SELECT * FROM surveyor_profiles WHERE user_id=$1', [userId]);
        if (sRows.length) profileStats.surveyor = sRows[0];
      }
    } catch {}
    try {
      const reviewerRepo = this.reviewerProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(ReviewerProfile) : null);
      if (reviewerRepo) {
        const rProfile = await reviewerRepo.findOne({ where: { userId } });
        if (rProfile) profileStats.reviewer = rProfile;
      } else {
        const rRows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [userId]);
        if (rRows.length) profileStats.reviewer = rRows[0];
      }
    } catch {}
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      status: user.status,
      roles,
      walletBalance,
      profileStats,
    };
  }

  async updateProfile(userId: string, dto: { fullName?: string; phone?: string; avatarUrl?: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (dto.fullName != null) user.fullName = dto.fullName;
    if (dto.phone !== undefined) user.phone = dto.phone || null;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl || null;
    await this.userRepo.save(user);
    const roles = await this.getRolesForUser(userId);
    let walletBalance = 0;
    try {
      const wallet = await this.walletRepo.findOne({ where: { userId } });
      if (wallet) {
        walletBalance = Number(wallet.balance);
      } else if (this.dataSource) {
        const wRows: any[] = await this.dataSource.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
        if (wRows.length) walletBalance = Number(wRows[0].balance);
      }
    } catch {}
    const profileStats: any = {};
    try {
      const driverRepo = this.driverProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(DriverProfile) : null);
      if (driverRepo) {
        const dProfile = await driverRepo.findOne({ where: { userId } });
        if (dProfile) profileStats.driver = dProfile;
      } else {
        const dRows: any[] = await this.dataSource.query('SELECT * FROM driver_profiles WHERE user_id=$1', [userId]);
        if (dRows.length) profileStats.driver = dRows[0];
      }
    } catch {}
    try {
      const surveyorRepo = this.surveyorProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(SurveyorProfile) : null);
      if (surveyorRepo) {
        const sProfile = await surveyorRepo.findOne({ where: { userId } });
        if (sProfile) profileStats.surveyor = sProfile;
      } else {
        const sRows: any[] = await this.dataSource.query('SELECT * FROM surveyor_profiles WHERE user_id=$1', [userId]);
        if (sRows.length) profileStats.surveyor = sRows[0];
      }
    } catch {}
    try {
      const reviewerRepo = this.reviewerProfileRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(ReviewerProfile) : null);
      if (reviewerRepo) {
        const rProfile = await reviewerRepo.findOne({ where: { userId } });
        if (rProfile) profileStats.reviewer = rProfile;
      } else {
        const rRows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [userId]);
        if (rRows.length) profileStats.reviewer = rRows[0];
      }
    } catch {}
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      status: user.status,
      roles,
      walletBalance,
      profileStats,
    };
  }

  async toggleRole(userId: string, roleCode: string, enabled = true) {
    const normalized = roleCode.toUpperCase();
    const ALLOWED_COMMUNITY_ROLES = ['SURVEYOR', 'REVIEWER'];
    if (!ALLOWED_COMMUNITY_ROLES.includes(normalized)) {
      throw new BadRequestException(`Role ${roleCode} is not allowed for self-management`);
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException(`Account is ${user.status}`);

    const role = await this.roleRepo.findOne({ where: { code: normalized } });
    if (!role) throw new BadRequestException(`Role ${normalized} not found`);

    if (enabled) {
      const existing = await this.userRoleRepo.findOne({ where: { userId, roleId: role.id } });
      if (!existing) {
        await this.userRoleRepo.save(this.userRoleRepo.create({ userId, roleId: role.id, isActive: true }));
      } else if (!existing.isActive) {
        existing.isActive = true;
        await this.userRoleRepo.save(existing);
      }

      if (normalized === 'SURVEYOR') {
        await this.dataSource.query(`INSERT INTO surveyor_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      } else if (normalized === 'REVIEWER') {
        await this.dataSource.query(`INSERT INTO reviewer_profiles (user_id, reliability_score) VALUES ($1, 0.5) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      }
    } else {
      const existing = await this.userRoleRepo.findOne({ where: { userId, roleId: role.id } });
      if (existing && existing.isActive) {
        existing.isActive = false;
        await this.userRoleRepo.save(existing);
      }
    }

    let currentRoles = await this.getRolesForUser(userId);
    if (currentRoles.length === 0) {
      const driverRole = await this.roleRepo.findOne({ where: { code: 'DRIVER' } });
      if (driverRole) {
        const existingDriver = await this.userRoleRepo.findOne({ where: { userId, roleId: driverRole.id } });
        if (existingDriver) {
          existingDriver.isActive = true;
          await this.userRoleRepo.save(existingDriver);
        } else {
          await this.userRoleRepo.save(this.userRoleRepo.create({ userId, roleId: driverRole.id, isActive: true }));
        }
        await this.dataSource.query(`INSERT INTO driver_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
      }
      currentRoles = await this.getRolesForUser(userId);
    }

    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, roles: currentRoles },
      accessToken: this.signToken(user, currentRoles),
    };
  }

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { sent: true, message: 'If the email exists, an OTP has been sent' };
    const otp = String(randomInt(100000, 1000000));
    const otpRepo = this.authOtpTokenRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(AuthOtpToken) : null);
    if (otpRepo) {
      await otpRepo.update({ email, used: false }, { used: true });
      await otpRepo.save(otpRepo.create({
        email,
        otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: false,
      }));
    } else {
      await this.dataSource.query(`UPDATE auth_otp_tokens SET used = true WHERE email = $1 AND used = false`, [email]);
      await this.dataSource.query(`INSERT INTO auth_otp_tokens (email, otp, expires_at) VALUES ($1,$2,$3)`, [email, otp, new Date(Date.now()+10*60*1000)]);
    }
    const isDev = process.env.NODE_ENV !== 'production';
    return isDev ? { sent: true, otp, expiresAt: new Date(Date.now()+10*60*1000) } : { sent: true, message: 'OTP sent to email' };
  }

  async verifyOtp(email: string, otp: string) {
    const otpRepo = this.authOtpTokenRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(AuthOtpToken) : null);
    if (otpRepo) {
      const token = await otpRepo.findOne({
        where: { email, otp, used: false },
        order: { createdAt: 'DESC' },
      });
      if (!token) throw new BadRequestException('Invalid OTP');
      if (new Date(token.expiresAt) < new Date()) throw new BadRequestException('OTP expired');
      return { valid: true, email };
    }
    const rows: any[] = await this.dataSource.query(`SELECT id, expires_at FROM auth_otp_tokens WHERE email=$1 AND otp=$2 AND used=false ORDER BY created_at DESC LIMIT 1`, [email, otp]);
    if (rows.length === 0) throw new BadRequestException('Invalid OTP');
    if (new Date(rows[0].expires_at) < new Date()) throw new BadRequestException('OTP expired');
    return { valid: true, email };
  }

  async resendOtp(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { sent: true, message: 'If the email exists, a new OTP has been sent' };
    const otp = String(randomInt(100000, 1000000));
    const otpRepo = this.authOtpTokenRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(AuthOtpToken) : null);
    if (otpRepo) {
      await otpRepo.update({ email, used: false }, { used: true });
      await otpRepo.save(otpRepo.create({
        email,
        otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: false,
      }));
    } else {
      await this.dataSource.query(`UPDATE auth_otp_tokens SET used = true WHERE email = $1 AND used = false`, [email]);
      await this.dataSource.query(`INSERT INTO auth_otp_tokens (email, otp, expires_at) VALUES ($1,$2,$3)`, [email, otp, new Date(Date.now() + 10 * 60 * 1000)]);
    }
    const isDev = process.env.NODE_ENV !== 'production';
    return isDev ? { sent: true, otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } : { sent: true, message: 'OTP resent' };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const otpRepo = this.authOtpTokenRepo ?? (typeof this.dataSource?.getRepository === 'function' ? this.dataSource.getRepository(AuthOtpToken) : null);
    if (otpRepo) {
      const token = await otpRepo.findOne({
        where: { email, otp, used: false },
        order: { createdAt: 'DESC' },
      });
      if (!token) throw new BadRequestException('Invalid OTP');
      if (new Date(token.expiresAt) < new Date()) throw new BadRequestException('OTP expired');
      const user = await this.userRepo.findOne({ where: { email } });
      if (!user) throw new BadRequestException('User not found');
      user.passwordHash = await bcrypt.hash(newPassword, 10);
      await this.userRepo.save(user);
      await otpRepo.update({ id: token.id }, { used: true });
      return { reset: true };
    }
    const rows: any[] = await this.dataSource.query(`SELECT id, expires_at FROM auth_otp_tokens WHERE email=$1 AND otp=$2 AND used=false ORDER BY created_at DESC LIMIT 1`, [email, otp]);
    if (rows.length === 0) throw new BadRequestException('Invalid OTP');
    if (new Date(rows[0].expires_at) < new Date()) throw new BadRequestException('OTP expired');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
    await this.dataSource.query(`UPDATE auth_otp_tokens SET used=true WHERE id=$1`, [rows[0].id]);
    return { reset: true };
  }
}
