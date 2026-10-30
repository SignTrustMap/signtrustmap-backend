import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UserStatus } from './persistence/user.entity';

describe('JwtStrategy', () => {
  const userRepo = { findOne: jest.fn() };
  const userRoleRepo = {};
  const configService = { get: jest.fn().mockReturnValue('test-secret') };
  const strategy = new JwtStrategy(
    configService as any,
    userRepo as any,
    userRoleRepo as any,
  );

  beforeEach(() => jest.resetAllMocks());

  it('accepts active users', async () => {
    userRepo.findOne.mockResolvedValue({
      fullName: 'Surveyor',
      status: UserStatus.ACTIVE,
    });

    await expect(strategy.validate({
      sub: 'user-1',
      email: 'surveyor@example.test',
      roles: ['SURVEYOR'],
    })).resolves.toEqual({
      id: 'user-1',
      email: 'surveyor@example.test',
      roles: ['SURVEYOR'],
      fullName: 'Surveyor',
      status: UserStatus.ACTIVE,
    });
  });

  it('rejects banned users so existing access tokens stop working', async () => {
    userRepo.findOne.mockResolvedValue({
      fullName: 'Banned user',
      status: UserStatus.BANNED,
    });

    await expect(strategy.validate({
      sub: 'user-1',
      email: 'user@example.test',
      roles: ['REVIEWER'],
    })).rejects.toThrow(UnauthorizedException);
  });
});
