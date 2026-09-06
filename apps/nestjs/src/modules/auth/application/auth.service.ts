import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { User, UserStatus } from '../infrastructure/persistence/user.entity';
import { UserRole } from '../infrastructure/persistence/user-role.entity';
import { Role } from '../infrastructure/persistence/role.entity';
import { Wallet } from '../../wallet/infrastructure/persistence/wallet.entity';
import { RegisterDto, LoginDto } from '../presentation/dto/auth.dto';
import { JwtPayload } from '../domain/auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole) private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
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
    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, { email: dto.email, passwordHash, fullName: dto.fullName, phone: dto.phone || null, status: UserStatus.ACTIVE });
      const savedUser = await manager.save(user);
      const defaultRole = await manager.findOne(Role, { where: { code: 'SURVEYOR' } });
      if (defaultRole) await manager.save(manager.create(UserRole, { userId: savedUser.id, roleId: defaultRole.id, isActive: true }));
      await manager.save(manager.create(Wallet, { userId: savedUser.id, balance: '0' }));
      const roles = defaultRole ? [defaultRole.code] : [];
      return { user: { id: savedUser.id, email: savedUser.email, fullName: savedUser.fullName }, accessToken: this.signToken(savedUser, roles) };
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

  async googleLogin(googleUser: { email: string; fullName: string; avatarUrl: string | null; providerUserId: string }) {
    if (!googleUser.email) throw new BadRequestException('Google profile has no email');
    let user = await this.userRepo.findOne({ where: { email: googleUser.email } });
    if (!user) {
      return this.dataSource.transaction(async (manager) => {
        const newUser = manager.create(User, { email: googleUser.email, passwordHash: null, fullName: googleUser.fullName, avatarUrl: googleUser.avatarUrl, status: UserStatus.ACTIVE });
        const saved = await manager.save(newUser);
        await manager.query(`INSERT INTO "oauth_accounts" ("user_id","provider","provider_user_id","email") VALUES ($1,'GOOGLE',$2,$3) ON CONFLICT ("provider","provider_user_id") DO NOTHING`, [saved.id, googleUser.providerUserId, googleUser.email]);
        const defaultRole = await manager.findOne(Role, { where: { code: 'SURVEYOR' } });
        if (defaultRole) await manager.save(manager.create(UserRole, { userId: saved.id, roleId: defaultRole.id, isActive: true }));
        await manager.save(manager.create(Wallet, { userId: saved.id, balance: '0' }));
        const roles = defaultRole ? [defaultRole.code] : [];
        return { user: { id: saved.id, email: saved.email, fullName: saved.fullName, roles }, accessToken: this.signToken(saved, roles) };
      });
    }
    await this.dataSource.query(`INSERT INTO "oauth_accounts" ("user_id","provider","provider_user_id","email") VALUES ($1,'GOOGLE',$2,$3) ON CONFLICT ("provider","provider_user_id") DO NOTHING`, [user.id, googleUser.providerUserId, googleUser.email]);
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
      const wRows: any[] = await this.dataSource.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      if (wRows.length) walletBalance = Number(wRows[0].balance);
    } catch {}
    let profileStats: any = {};
    try {
      const dRows: any[] = await this.dataSource.query('SELECT * FROM driver_profiles WHERE user_id=$1', [userId]);
      if (dRows.length) profileStats.driver = dRows[0];
    } catch {}
    try {
      const sRows: any[] = await this.dataSource.query('SELECT * FROM surveyor_profiles WHERE user_id=$1', [userId]);
      if (sRows.length) profileStats.surveyor = sRows[0];
    } catch {}
    try {
      const rRows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [userId]);
      if (rRows.length) profileStats.reviewer = rRows[0];
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

  private async ensureOtpTable() {
    try {
      await this.dataSource.query(`CREATE TABLE IF NOT EXISTS auth_otp_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(255) NOT NULL, otp varchar(10) NOT NULL,
        expires_at timestamptz NOT NULL, used boolean DEFAULT false, created_at timestamptz DEFAULT now())`);
      await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_auth_otp_email ON auth_otp_tokens (email, used, expires_at)`);
    } catch {}
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
      const wRows: any[] = await this.dataSource.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      if (wRows.length) walletBalance = Number(wRows[0].balance);
    } catch {}
    let profileStats: any = {};
    try {
      const dRows: any[] = await this.dataSource.query('SELECT * FROM driver_profiles WHERE user_id=$1', [userId]);
      if (dRows.length) profileStats.driver = dRows[0];
    } catch {}
    try {
      const sRows: any[] = await this.dataSource.query('SELECT * FROM surveyor_profiles WHERE user_id=$1', [userId]);
      if (sRows.length) profileStats.surveyor = sRows[0];
    } catch {}
    try {
      const rRows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [userId]);
      if (rRows.length) profileStats.reviewer = rRows[0];
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

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { sent: true, message: 'If the email exists, an OTP has been sent' };
    await this.ensureOtpTable();
    const otp = String(randomInt(100000, 1000000));
    await this.dataSource.query(`UPDATE auth_otp_tokens SET used = true WHERE email = $1 AND used = false`, [email]);
    await this.dataSource.query(`INSERT INTO auth_otp_tokens (email, otp, expires_at) VALUES ($1,$2,$3)`, [email, otp, new Date(Date.now()+10*60*1000)]);
    const isDev = process.env.NODE_ENV !== 'production';
    return isDev ? { sent: true, otp, expiresAt: new Date(Date.now()+10*60*1000) } : { sent: true, message: 'OTP sent to email' };
  }

  async verifyOtp(email: string, otp: string) {
    await this.ensureOtpTable();
    const rows: any[] = await this.dataSource.query(`SELECT id, expires_at FROM auth_otp_tokens WHERE email=$1 AND otp=$2 AND used=false ORDER BY created_at DESC LIMIT 1`, [email, otp]);
    if (rows.length === 0) throw new BadRequestException('Invalid OTP');
    if (new Date(rows[0].expires_at) < new Date()) throw new BadRequestException('OTP expired');
    return { valid: true, email };
  }

  async resendOtp(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { sent: true, message: 'If the email exists, a new OTP has been sent' };
    await this.ensureOtpTable();
    const otp = String(randomInt(100000, 1000000));
    await this.dataSource.query(`UPDATE auth_otp_tokens SET used = true WHERE email = $1 AND used = false`, [email]);
    await this.dataSource.query(`INSERT INTO auth_otp_tokens (email, otp, expires_at) VALUES ($1,$2,$3)`, [email, otp, new Date(Date.now() + 10 * 60 * 1000)]);
    const isDev = process.env.NODE_ENV !== 'production';
    return isDev ? { sent: true, otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } : { sent: true, message: 'OTP resent' };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    await this.ensureOtpTable();
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
