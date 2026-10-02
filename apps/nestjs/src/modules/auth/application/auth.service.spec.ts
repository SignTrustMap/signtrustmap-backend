import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService (Registration and Role Assignment)', () => {
  let service: AuthService;
  let mockUserRepo: any;
  let mockUserRoleRepo: any;
  let mockRoleRepo: any;
  let mockWalletRepo: any;
  let mockJwtService: any;
  let mockDataSource: any;
  let mockConfigService: any;

  const mockRoleMap: Record<string, { id: number; code: string }> = {
    SURVEYOR: { id: 1, code: 'SURVEYOR' },
    DRIVER: { id: 2, code: 'DRIVER' },
    REVIEWER: { id: 3, code: 'REVIEWER' },
  };

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockUserRoleRepo = {
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockRoleRepo = {
      findOne: jest.fn(),
    };

    mockWalletRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    mockConfigService = {
      get: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        const mockManager = {
          create: jest.fn().mockImplementation((entityClass, data) => data),
          save: jest.fn().mockImplementation(async (data) => ({ id: 'new-user-id', ...data })),
          findOne: jest.fn().mockImplementation(async (entityClass, opts) => {
            const code = opts?.where?.code;
            return mockRoleMap[code] || null;
          }),
          query: jest.fn().mockResolvedValue([]),
        };
        return cb(mockManager);
      }),
      query: jest.fn().mockResolvedValue([]),
    };

    service = new AuthService(
      mockUserRepo,
      mockUserRoleRepo,
      mockRoleRepo,
      mockWalletRepo,
      mockJwtService,
      mockDataSource,
      mockConfigService,
    );
  });

  it('registers with default SURVEYOR role when role is omitted', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    const result = await service.register({
      email: 'surveyor@test.dev',
      password: 'Password@123',
      fullName: 'Test Surveyor',
    });

    expect(result.user.roles).toEqual(['SURVEYOR']);
    expect(result.accessToken).toBe('mock-jwt-token');
  });

  it('registers with DRIVER role when requested', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    const result = await service.register({
      email: 'driver@test.dev',
      password: 'Password@123',
      fullName: 'Test Driver',
      role: 'driver',
    });

    expect(result.user.roles).toEqual(['DRIVER']);
    expect(result.accessToken).toBe('mock-jwt-token');
  });

  it('registers with REVIEWER role when requested', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    const result = await service.register({
      email: 'reviewer@test.dev',
      password: 'Password@123',
      fullName: 'Test Reviewer',
      role: 'REVIEWER',
    });

    expect(result.user.roles).toEqual(['REVIEWER']);
  });

  it('rejects self-registration with ADMIN role', async () => {
    mockUserRepo.findOne.mockResolvedValue(null);

    await expect(
      service.register({
        email: 'hacker@test.dev',
        password: 'Password@123',
        fullName: 'Fake Admin',
        role: 'ADMIN',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects registration if email already exists', async () => {
    mockUserRepo.findOne.mockResolvedValue({ id: 'existing-id' });

    await expect(
      service.register({
        email: 'existing@test.dev',
        password: 'Password@123',
        fullName: 'Existing User',
      }),
    ).rejects.toThrow(ConflictException);
  });

  describe('login', () => {
    it('throws UnauthorizedException if user not found or no password hash', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.login({ email: 'missing@test.dev', password: 'pwd' })).rejects.toThrow(
        UnauthorizedException,
      );

      mockUserRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash: null });
      await expect(service.login({ email: 'nopass@test.dev', password: 'pwd' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException if user status is suspended', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        passwordHash: 'hash',
        status: 'SUSPENDED',
      });
      await expect(service.login({ email: 'susp@test.dev', password: 'pwd' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('logs in successfully with valid password', async () => {
      const hash = await bcrypt.hash('CorrectPassword@123', 10);
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'driver@test.dev',
        fullName: 'Test Driver',
        passwordHash: hash,
        status: 'ACTIVE',
      });
      mockUserRoleRepo.find.mockResolvedValue([
        { role: { code: 'DRIVER' }, isActive: true },
      ]);

      const res = await service.login({ email: 'driver@test.dev', password: 'CorrectPassword@123' });
      expect(res.user.email).toBe('driver@test.dev');
      expect(res.accessToken).toBe('mock-jwt-token');
      expect(res.user.roles).toEqual(['DRIVER']);
    });
  });

  describe('getProfile & updateProfile', () => {
    it('getProfile throws if user missing', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.getProfile('missing-id')).rejects.toThrow(UnauthorizedException);
    });

    it('getProfile returns user with wallet and profile stats', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'driver@test.dev',
        fullName: 'Test Driver',
        status: 'ACTIVE',
      });
      mockUserRoleRepo.find.mockResolvedValue([
        { role: { code: 'DRIVER' }, isActive: true },
      ]);
      mockDataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('wallets')) return [{ balance: '150' }];
        return [];
      });

      const res = await service.getProfile('user-1');
      expect(res.id).toBe('user-1');
      expect(res.walletBalance).toBe(150);
      expect(res.roles).toEqual(['DRIVER']);
    });

    it('updateProfile updates fields and returns refreshed user', async () => {
      const user = {
        id: 'user-1',
        email: 'driver@test.dev',
        fullName: 'Old Name',
        phone: null,
        avatarUrl: null,
        status: 'ACTIVE',
      };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);
      mockUserRoleRepo.find.mockResolvedValue([]);

      const res = await service.updateProfile('user-1', {
        fullName: 'New Name',
        phone: '0901234567',
        avatarUrl: 'https://s3/pic.jpg',
      });
      expect(res.fullName).toBe('New Name');
      expect(res.phone).toBe('0901234567');
      expect(res.avatarUrl).toBe('https://s3/pic.jpg');
      expect(mockUserRepo.save).toHaveBeenCalled();
    });
  });

  describe('Password Recovery (OTP)', () => {
    it('forgotPassword handles missing email safely', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      const res = await service.forgotPassword('missing@test.dev');
      expect(res.sent).toBe(true);
    });

    it('forgotPassword generates OTP and records token', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'u-1', email: 'user@test.dev' });
      const res = await service.forgotPassword('user@test.dev');
      expect(res.sent).toBe(true);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auth_otp_tokens'),
        expect.any(Array),
      );
    });

    it('verifyOtp validates unexpired token', async () => {
      mockDataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, expires_at FROM auth_otp_tokens')) {
          return [{ id: 'otp-1', expires_at: new Date(Date.now() + 60000) }];
        }
        return [];
      });
      const res = await service.verifyOtp('user@test.dev', '123456');
      expect(res.valid).toBe(true);
    });

    it('verifyOtp rejects invalid or expired token', async () => {
      mockDataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, expires_at FROM auth_otp_tokens')) {
          return [];
        }
        return [];
      });
      await expect(service.verifyOtp('user@test.dev', 'wrong')).rejects.toThrow(BadRequestException);

      mockDataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, expires_at FROM auth_otp_tokens')) {
          return [{ id: 'otp-1', expires_at: new Date(Date.now() - 60000) }];
        }
        return [];
      });
      await expect(service.verifyOtp('user@test.dev', 'expired')).rejects.toThrow(BadRequestException);
    });

    it('resetPassword updates user passwordHash and marks OTP used', async () => {
      mockDataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, expires_at FROM auth_otp_tokens')) {
          return [{ id: 'otp-1', expires_at: new Date(Date.now() + 60000) }];
        }
        return [];
      });
      const user = { id: 'u-1', email: 'user@test.dev', passwordHash: 'old' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      const res = await service.resetPassword('user@test.dev', '123456', 'NewPassword@123');
      expect(res.reset).toBe(true);
      expect(user.passwordHash).not.toBe('old');
      expect(mockUserRepo.save).toHaveBeenCalled();
    });
  });
});
