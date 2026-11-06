import { Controller, Post, Get, Patch, Body, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../application/auth.service';
import { RegisterDto, LoginDto, UpdateProfileDto, ForgotPasswordDto, VerifyOtpDto, ResetPasswordDto, ResendOtpDto, ToggleRoleDto } from './dto/auth.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
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
  @ApiOperation({ summary: 'Google OAuth2 token verification', description: 'Verify a Google ID token from a mobile app and log in or auto-register the user' })
  @Post('google')
  async googleTokenLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleTokenLogin(dto.token);
  }

  @Public()
  @ApiOperation({ summary: 'Google OAuth2 callback', description: 'Callback endpoint handling Google OAuth2 response' })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res({ passthrough: true }) res?: any) {
    // req.user is set by GoogleStrategy.validate
    const authResult = await this.authService.googleLogin(req.user);
    const frontendUrl = process.env.WEB_URL || process.env.FRONTEND_URL || 'https://signmap.site';
    if (res && typeof res.redirect === 'function' && !req?.headers?.accept?.includes('application/json')) {
      return res.redirect(`${frontendUrl}/login?token=${authResult.accessToken}`);
    }
    return authResult;
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

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle or enroll community role', description: 'Allow authenticated users to activate or deactivate optional community roles (SURVEYOR or REVIEWER). Returns refreshed user and access token.' })
  @Post('me/roles')
  async toggleRole(@CurrentUser() user: any, @Body() dto: ToggleRoleDto) {
    return this.authService.toggleRole(user.id, dto.role, dto.enabled ?? true);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enroll in community role', description: 'Allow authenticated users to enroll in SURVEYOR or REVIEWER role. Returns refreshed user and access token.' })
  @Post('roles/enroll')
  async enrollRole(@CurrentUser() user: any, @Body() dto: ToggleRoleDto) {
    return this.authService.toggleRole(user.id, dto.role, dto.enabled ?? true);
  }
}
