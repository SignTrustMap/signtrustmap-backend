import { IsString, IsOptional, IsInt, IsBoolean, MaxLength, IsNumberString } from 'class-validator';

export class CreateSignCategoryDto {
  @IsString()
  @MaxLength(50)
  code: string;

  @IsString()
  @MaxLength(100)
  nameVi: string;

  @IsString()
  @MaxLength(100)
  nameEn: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameVi?: string;

  @IsOptional()
  @IsString()
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
  @IsInt()
  categoryId: number;

  @IsString()
  @MaxLength(50)
  signCode: string;

  @IsString()
  @MaxLength(255)
  nameVi: string;

  @IsString()
  @MaxLength(255)
  nameEn: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  labelingGuidelines?: string;

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
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  signCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  labelingGuidelines?: string | null;

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
