import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCameraProfileDto {
  @ApiProperty({ description: 'Device/camera model name or description', example: 'iPhone 15 Pro - Dashcam Mount' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceModel: string;

  @ApiPropertyOptional({ description: 'Camera mounting height above road surface in meters', default: 1.35 })
  @IsOptional()
  @IsNumber()
  @Min(0.3)
  @Max(5.0)
  cameraHeightMeters?: number;

  @ApiPropertyOptional({ description: 'Vertical pitch angle tilt in degrees (-45 downward to +45 upward)', default: 0.0 })
  @IsOptional()
  @IsNumber()
  @Min(-45.0)
  @Max(45.0)
  pitchAngleDegrees?: number;

  @ApiPropertyOptional({ description: 'Horizontal yaw offset angle in degrees (-45 left to +45 right)', default: 0.0 })
  @IsOptional()
  @IsNumber()
  @Min(-45.0)
  @Max(45.0)
  yawOffsetDegrees?: number;

  @ApiPropertyOptional({ description: 'Horizontal field of view (HFOV) in degrees', default: 60.0 })
  @IsOptional()
  @IsNumber()
  @Min(20.0)
  @Max(170.0)
  hfovDegrees?: number;

  @ApiPropertyOptional({ description: 'Estimated optical focal length in pixels' })
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  focalLengthPx?: number;

  @ApiPropertyOptional({ description: 'Whether this profile is default for surveys', default: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
