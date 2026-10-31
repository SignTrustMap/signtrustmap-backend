import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../common/vehicle-types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSignCategoryDto {
  @ApiProperty({ description: 'Category code', pattern: '^[A-Za-z0-9_-]+$', example: 'REGULATORY' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code: string;

  @ApiProperty({ description: 'Vietnamese category name', minLength: 1, maxLength: 100, example: 'Biển báo cấm' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameVi: string;

  @ApiProperty({ description: 'English category name', minLength: 1, maxLength: 100, example: 'Regulatory' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn: string;

  @ApiPropertyOptional({ description: 'Optional description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Icon URL', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @ApiPropertyOptional({ description: 'Sort order index', example: 1 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateSignCategoryDto {
  @ApiPropertyOptional({ description: 'Category code', pattern: '^[A-Za-z0-9_-]+$', example: 'REGULATORY' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameVi?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateSignTypeDto {
  @ApiProperty({ description: 'Category ID', minimum: 1, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;

  @ApiProperty({ description: 'Traffic sign code (e.g. W.201a)', pattern: '^[A-Za-z0-9._-]+$', example: 'W.201a' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9._-]+$/)
  signCode: string;

  @ApiPropertyOptional({ description: 'Slug', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  slug?: string;

  @ApiProperty({ description: 'Vietnamese sign name', minLength: 1, maxLength: 255, example: 'Chỗ ngoặt nguy hiểm' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameVi: string;

  @ApiProperty({ description: 'English sign name', minLength: 1, maxLength: 255, example: 'Dangerous bend' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  labelingGuidelines?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  aiLabelPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  osmMapping?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  representativeImageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  shape?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  colorScheme?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(VEHICLE_TYPES), { each: true })
  allowedVehicles?: VehicleType[];
}

export class UpdateSignTypeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Traffic sign code (e.g. W.201a)', pattern: '^[A-Za-z0-9._-]+$', example: 'W.201a' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9._-]+$/)
  signCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  slug?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameVi?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  labelingGuidelines?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  aiLabelPrompt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  osmMapping?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  representativeImageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  shape?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  colorScheme?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(VEHICLE_TYPES), { each: true })
  allowedVehicles?: VehicleType[];
}

export class UpsertSystemParameterDto {
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ListSignTypesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateSupportShotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @IsIn(['ANCHOR', 'MEDOID', 'REPRESENTATIVE'])
  role?: string;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  sharpness?: number;
}

export class SetSupportShotPinDto {
  @IsBoolean()
  isPinned: boolean;
}

export class ReprocessCandidatesDto {
  @ApiPropertyOptional({ description: 'Cosine similarity threshold (0.0 to 1.0)', minimum: 0, maximum: 1, example: 0.85 })
  @IsOptional()
  @Type(() => Number)
  @Max(1)
  @Min(0)
  similarityThreshold?: number;
}


