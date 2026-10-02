import { AuthController } from './auth.controller';
import { AuthService } from '../application/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: {
    register: jest.Mock;
    login: jest.Mock;
    forgotPassword: jest.Mock;
    verifyOtp: jest.Mock;
    resendOtp: jest.Mock;
    resetPassword: jest.Mock;
    googleTokenLogin: jest.Mock;
    googleLogin: jest.Mock;
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
  };

  const mockUser = { id: 'u-123', email: 'test@example.com' };

  beforeEach(() => {
    service = {
      register: jest.fn().mockResolvedValue({ token: 'jwt-token' }),
      login: jest.fn().mockResolvedValue({ token: 'jwt-token' }),
      forgotPassword: jest.fn().mockResolvedValue({ message: 'OTP sent' }),
      verifyOtp: jest.fn().mockResolvedValue({ valid: true }),
      resendOtp: jest.fn().mockResolvedValue({ message: 'OTP resent' }),
      resetPassword: jest.fn().mockResolvedValue({ message: 'Password reset' }),
      googleTokenLogin: jest.fn().mockResolvedValue({ token: 'jwt-token' }),
      googleLogin: jest.fn().mockResolvedValue({ token: 'jwt-token' }),
      getProfile: jest.fn().mockResolvedValue({ id: 'u-123', email: 'test@example.com' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'u-123', fullName: 'Updated' }),
    };

    controller = new AuthController(service as unknown as AuthService);
  });

  it('register delegates to authService.register', async () => {
    const dto = { email: 'a@b.com', password: 'pass', fullName: 'Alice' } as any;
    const res = await controller.register(dto);
    expect(res).toEqual({ token: 'jwt-token' });
    expect(service.register).toHaveBeenCalledWith(dto);
  });

  it('login delegates to authService.login', async () => {
    const dto = { email: 'a@b.com', password: 'pass' } as any;
    const res = await controller.login(dto);
    expect(res).toEqual({ token: 'jwt-token' });
    expect(service.login).toHaveBeenCalledWith(dto);
  });

  it('forgotPassword delegates to authService.forgotPassword', async () => {
    const res = await controller.forgotPassword({ email: 'a@b.com' });
    expect(res).toEqual({ message: 'OTP sent' });
    expect(service.forgotPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('verifyOtp delegates to authService.verifyOtp', async () => {
    const res = await controller.verifyOtp({ email: 'a@b.com', otp: '123456' });
    expect(res).toEqual({ valid: true });
    expect(service.verifyOtp).toHaveBeenCalledWith('a@b.com', '123456');
  });

  it('resendOtp delegates to authService.resendOtp', async () => {
    const res = await controller.resendOtp({ email: 'a@b.com' });
    expect(res).toEqual({ message: 'OTP resent' });
    expect(service.resendOtp).toHaveBeenCalledWith('a@b.com');
  });

  it('resetPassword delegates to authService.resetPassword', async () => {
    const res = await controller.resetPassword({ email: 'a@b.com', otp: '123456', newPassword: 'new' });
    expect(res).toEqual({ message: 'Password reset' });
    expect(service.resetPassword).toHaveBeenCalledWith('a@b.com', '123456', 'new');
  });

  it('googleTokenLogin delegates to authService.googleTokenLogin', async () => {
    const res = await controller.googleTokenLogin({ token: 'google-token' });
    expect(res).toEqual({ token: 'jwt-token' });
    expect(service.googleTokenLogin).toHaveBeenCalledWith('google-token');
  });

  it('googleCallback delegates to authService.googleLogin', async () => {
    const req = { user: { email: 'g@b.com' } };
    const res = await controller.googleCallback(req);
    expect(res).toEqual({ token: 'jwt-token' });
    expect(service.googleLogin).toHaveBeenCalledWith(req.user);
  });

  it('me delegates to authService.getProfile', async () => {
    const res = await controller.me(mockUser);
    expect(res).toEqual({ id: 'u-123', email: 'test@example.com' });
    expect(service.getProfile).toHaveBeenCalledWith(mockUser.id);
  });

  it('updateMe delegates to authService.updateProfile', async () => {
    const dto = { fullName: 'Updated' } as any;
    const res = await controller.updateMe(mockUser, dto);
    expect(res).toEqual({ id: 'u-123', fullName: 'Updated' });
    expect(service.updateProfile).toHaveBeenCalledWith(mockUser.id, dto);
  });
});
