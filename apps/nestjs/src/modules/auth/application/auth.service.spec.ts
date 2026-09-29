import { BadRequestException, ConflictException } from '@nestjs/common';
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
});
