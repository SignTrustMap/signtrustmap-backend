import { Transform, Type } from 'class-transformer';
import {
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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSignCategoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameVi: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateSignCategoryDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9._-]+$/)
  signCode: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nameVi: string;

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
  @IsString()
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
}

export class UpdateSignTypeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

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
  @IsString()
  @MaxLength(500)
  representativeImageKey?: string | null;

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
