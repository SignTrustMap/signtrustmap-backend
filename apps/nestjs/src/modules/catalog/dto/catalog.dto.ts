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

  @ApiPropertyOptional({ description: 'Vietnamese category name', minLength: 1, maxLength: 100, example: 'Biển báo cấm' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameVi?: string;

  @ApiPropertyOptional({ description: 'English category name', minLength: 1, maxLength: 100, example: 'Regulatory' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional({ description: 'Optional description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Icon URL', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string | null;

  @ApiPropertyOptional({ description: 'Sort order index', example: 1 })
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

  @ApiPropertyOptional({ description: 'Sign description', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Labeling guidelines for annotation', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  labelingGuidelines?: string;

  @ApiPropertyOptional({ description: 'AI prompt instructions for sign detection', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  aiLabelPrompt?: string;

  @ApiPropertyOptional({ description: 'OpenStreetMap tag mapping', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  osmMapping?: string;

  @ApiPropertyOptional({ description: 'Representative image key or URL', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  representativeImageKey?: string;

  @ApiPropertyOptional({ description: 'Physical shape (e.g. TRIANGLE, CIRCLE, RECTANGLE)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  shape?: string;

  @ApiPropertyOptional({ description: 'Color scheme (e.g. RED_WHITE, BLUE_WHITE)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  colorScheme?: string;

  @ApiPropertyOptional({ description: 'Whether the sign type is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Applicable vehicle types', type: [String], enum: Object.values(VEHICLE_TYPES) })
  @IsOptional()
  @IsArray()
  @IsIn(Object.values(VEHICLE_TYPES), { each: true })
  allowedVehicles?: VehicleType[];
}

export class UpdateSignTypeDto {
  @ApiPropertyOptional({ description: 'Category ID', minimum: 1, example: 1 })
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

  @ApiPropertyOptional({ description: 'Slug', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  slug?: string | null;

  @ApiPropertyOptional({ description: 'Vietnamese sign name', minLength: 1, maxLength: 255, example: 'Chỗ ngoặt nguy hiểm' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameVi?: string;

  @ApiPropertyOptional({ description: 'English sign name', minLength: 1, maxLength: 255, example: 'Dangerous bend' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional({ description: 'Sign description', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Labeling guidelines for annotation', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  labelingGuidelines?: string | null;

  @ApiPropertyOptional({ description: 'AI prompt instructions for sign detection', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  aiLabelPrompt?: string | null;

  @ApiPropertyOptional({ description: 'OpenStreetMap tag mapping', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  osmMapping?: string | null;

  @ApiPropertyOptional({ description: 'Representative image key or URL', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  representativeImageKey?: string;

  @ApiPropertyOptional({ description: 'Physical shape (e.g. TRIANGLE, CIRCLE, RECTANGLE)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  shape?: string | null;

  @ApiPropertyOptional({ description: 'Color scheme (e.g. RED_WHITE, BLUE_WHITE)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  colorScheme?: string | null;

  @ApiPropertyOptional({ description: 'Whether the sign type is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Applicable vehicle types', type: [String], enum: Object.values(VEHICLE_TYPES) })
  @IsOptional()
  @IsArray()
  @IsIn(Object.values(VEHICLE_TYPES), { each: true })
  allowedVehicles?: VehicleType[];
}

export class UpsertSystemParameterDto {
  @ApiProperty({ description: 'System parameter value', example: '10' })
  @IsString()
  value: string;

  @ApiPropertyOptional({ description: 'Parameter description', example: 'Review consensus quorum threshold' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ListSignTypesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category ID', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Filter by active status', enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @ApiPropertyOptional({ description: 'Search term by name or code' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ description: 'Alias for search query' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  q?: string;

  @ApiPropertyOptional({ description: 'Page number (0-based)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size limit', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  @ApiPropertyOptional({ description: 'Page size limit (alias)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateSupportShotDto {
  @ApiProperty({ description: 'Support shot image URL', maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  imageUrl: string;

  @ApiPropertyOptional({ description: 'Support shot role', enum: ['ANCHOR', 'MEDOID', 'REPRESENTATIVE'] })
  @IsOptional()
  @IsString()
  @IsIn(['ANCHOR', 'MEDOID', 'REPRESENTATIVE'])
  role?: string;

  @ApiPropertyOptional({ description: 'Whether the support shot is pinned' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ description: 'Whether the support shot is primary' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ description: 'Sharpness score' })
  @IsOptional()
  sharpness?: number;
}

export class SetSupportShotPinDto {
  @ApiProperty({ description: 'Pin status' })
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


