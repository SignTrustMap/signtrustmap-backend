import {
  ArrayMinSize,
  ArrayMaxSize,
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

export class BatchImageItemDto {
  @ApiProperty({ description: 'MinIO storage object key for image', example: 'stm-raw-images/batch/img_001.jpg' })
  @IsString()
  @IsNotEmpty()
  storageKey: string;

  @ApiProperty({ description: 'Latitude coordinate of the camera', example: 10.8231 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate of the camera', example: 106.6297 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Compass bearing heading in degrees (0-360)', example: 90.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  bearing?: number;

  @ApiPropertyOptional({ description: 'Capture timestamp in milliseconds', example: 1718000000000 })
  @IsOptional()
  @IsNumber()
  timestampMs?: number;

  @ApiPropertyOptional({ description: 'File size in bytes', example: 250000 })
  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;
}

export class CreateBatchSurveyDto {
  @ApiPropertyOptional({ description: 'Optional batch title or survey description', example: 'Highway 1A Sign Inventory Batch' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiProperty({ description: 'ISO8601 capture timestamp', example: '2026-09-25T10:00:00.000Z' })
  @IsISO8601({ strict: true })
  capturedAt: string;

  @ApiPropertyOptional({ enum: CoordinateSource, default: CoordinateSource.DEVICE_GPS })
  @IsOptional()
  @IsEnum(CoordinateSource)
  coordinateSource?: CoordinateSource;

  @ApiPropertyOptional({ description: 'Optional notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ type: [BatchImageItemDto], description: 'List of images with geo-tagging and storage references' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchImageItemDto)
  images: BatchImageItemDto[];
}
