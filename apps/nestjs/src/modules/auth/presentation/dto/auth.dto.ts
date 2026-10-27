import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, MaxLength, IsIn, IsBoolean } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Account password (minimum 8 characters)', example: 'Password@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: 'User full name', example: 'Nguyen Van A', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  fullName: string;

  @ApiPropertyOptional({ description: 'Contact phone number', example: '0901234567', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Initial role code. Defaults to DRIVER if omitted.',
    enum: ['SURVEYOR', 'DRIVER', 'REVIEWER'],
    example: 'DRIVER',
    default: 'DRIVER',
  })
  @IsOptional()
  @IsString()
  @IsIn(['SURVEYOR', 'DRIVER', 'REVIEWER', 'surveyor', 'driver', 'reviewer'], {
    message: 'role must be one of SURVEYOR, DRIVER, REVIEWER',
  })
  role?: string;
}

export class ToggleRoleDto {
  @ApiProperty({
    description: 'Community role code to activate or deactivate',
    enum: ['SURVEYOR', 'REVIEWER'],
    example: 'SURVEYOR',
  })
  @IsString()
  @IsIn(['SURVEYOR', 'REVIEWER', 'surveyor', 'reviewer'], {
    message: 'role must be one of SURVEYOR, REVIEWER',
  })
  role: string;

  @ApiPropertyOptional({
    description: 'Whether the role should be enabled (true) or disabled (false). Defaults to true.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(10)
  otp: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(10)
  otp: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ResendOtpDto {
  @IsEmail()
  email: string;
}
