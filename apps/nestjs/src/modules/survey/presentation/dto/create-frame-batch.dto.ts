import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CoordinateSource } from '../../domain/submission-contract';

export class FrameMetadataDto {
  @ApiProperty({ description: 'Frame sequence index (0-based)', example: 0 })
  @IsNumber()
  @Min(0)
  frameIndex: number;

  @ApiProperty({ description: 'Capture timestamp in milliseconds', example: 1718000000000 })
  @IsNumber()
  timestampMs: number;

  @ApiProperty({ description: 'Latitude coordinate of the camera', example: 21.028511 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate of the camera', example: 105.854444 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Compass bearing heading in degrees (0-360)', example: 92.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  bearing?: number;

  @ApiPropertyOptional({ description: 'Vehicle speed in m/s or km/h', example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @ApiProperty({ description: 'MinIO storage object key for this sampled frame', example: 'stm-raw-videos/frames/user1/frame_000.jpg' })
  @IsString()
  @IsNotEmpty()
  storageKey: string;

  @ApiPropertyOptional({ description: 'Frame file size in bytes', example: 125000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fileSizeBytes?: number;

  @ApiPropertyOptional({ description: 'SHA-256 checksum of frame image', example: 'a1b2c3d4...' })
  @IsOptional()
  @IsString()
  checksum?: string;
}

export class CreateFrameBatchSessionDto {
  @ApiProperty({ description: 'ISO8601 capture start timestamp', example: '2026-06-15T08:30:00.000Z' })
  @IsISO8601({ strict: true })
  capturedAt: string;

  @ApiPropertyOptional({ enum: CoordinateSource, default: CoordinateSource.DEVICE_GPS })
  @IsOptional()
  @IsEnum(CoordinateSource)
  coordinateSource?: CoordinateSource;

  @ApiPropertyOptional({ description: 'Optional camera calibration profile ID to use for 3D coordinate estimation' })
  @IsOptional()
  @IsString()
  cameraProfileId?: string;

  @ApiPropertyOptional({ description: 'Survey sampling rate in frames per second (typically 5 to 10 FPS)', default: 5.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(60.0)
  fps?: number;

  @ApiPropertyOptional({ description: 'Optional surveyor notes or metadata' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ type: [FrameMetadataDto], description: 'Ordered list of sampled frames with GPS coordinates and storage references' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FrameMetadataDto)
  frames: FrameMetadataDto[];
}
