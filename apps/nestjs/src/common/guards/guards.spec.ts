import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InternalTokenGuard } from './internal-token.guard';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('Common Guards', () => {
  describe('InternalTokenGuard', () => {
    let guard: InternalTokenGuard;
    const originalToken = process.env.INTERNAL_TOKEN;

    beforeEach(() => {
      guard = new InternalTokenGuard();
      process.env.INTERNAL_TOKEN = 'test-secret-token';
    });

    afterEach(() => {
      process.env.INTERNAL_TOKEN = originalToken;
    });

    it('allows access with valid header', () => {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-internal-token': 'test-secret-token' } }),
        }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('throws UnauthorizedException with missing or wrong header', () => {
      const ctx1 = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as unknown as ExecutionContext;
      expect(() => guard.canActivate(ctx1)).toThrow(UnauthorizedException);

      const ctx2 = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-internal-token': 'wrong-token' } }),
        }),
      } as unknown as ExecutionContext;
      expect(() => guard.canActivate(ctx2)).toThrow(UnauthorizedException);
    });
  });

  describe('RolesGuard', () => {
    let guard: RolesGuard;
    let reflector: { getAllAndOverride: jest.Mock };

    beforeEach(() => {
      reflector = { getAllAndOverride: jest.fn() };
      guard = new RolesGuard(reflector as unknown as Reflector);
    });

    it('allows access if route is public', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(true); // isPublic
      const ctx = { getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows access if no required roles are defined', () => {
      reflector.getAllAndOverride
        .mockReturnValueOnce(false) // isPublic
        .mockReturnValueOnce(undefined); // requiredRoles
      const ctx = { getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('denies access if user is missing or has no roles', () => {
      reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['ADMIN']);
      const ctx = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('allows access if user has required role', () => {
      reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['ADMIN']);
      const ctx = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => ({ user: { roles: ['ADMIN', 'SURVEYOR'] } }) }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('JwtAuthGuard', () => {
    let guard: JwtAuthGuard;
    let reflector: { getAllAndOverride: jest.Mock };

    beforeEach(() => {
      reflector = { getAllAndOverride: jest.fn() };
      guard = new JwtAuthGuard(reflector as unknown as Reflector);
    });

    it('allows access if route is public', () => {
      reflector.getAllAndOverride.mockReturnValueOnce(true);
      const ctx = { getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
