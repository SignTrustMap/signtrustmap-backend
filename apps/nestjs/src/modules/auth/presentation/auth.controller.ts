import { Controller, Post, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../application/auth.service';
import { RegisterDto, LoginDto, UpdateProfileDto, ForgotPasswordDto, VerifyOtpDto, ResetPasswordDto, ResendOtpDto } from './dto/auth.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Register a new user account', description: 'Create a surveyor/driver account with email and password' })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @ApiOperation({ summary: 'Authenticate user', description: 'Log in with email and password to receive JWT access token' })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @ApiOperation({ summary: 'Forgot password request', description: 'Request password reset OTP via registered email' })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @ApiOperation({ summary: 'Verify OTP code', description: 'Validate OTP code sent to user email' })
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp);
  }

  @Public()
  @ApiOperation({ summary: 'Resend OTP code', description: 'Resend verification OTP code to user email' })
  @Post('resend-otp')
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }

  @Public()
  @ApiOperation({ summary: 'Reset password with OTP', description: 'Set new password using validated OTP code' })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  // Scaffolding for Google OAuth2 – redirect to Google
  @Public()
  @ApiOperation({ summary: 'Google OAuth2 login redirect', description: 'Redirect to Google authentication consent screen' })
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Passport redirects to Google – handler never reached
  }

  @Public()
  @ApiOperation({ summary: 'Google OAuth2 callback', description: 'Callback endpoint handling Google OAuth2 response' })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any) {
    // req.user is set by GoogleStrategy.validate
    return this.authService.googleLogin(req.user);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile', description: 'Retrieve profile details, roles, and balance of authenticated user' })
  @Get('me')
  async me(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile', description: 'Update profile information such as full name or phone number' })
  @Patch('me')
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }
}
