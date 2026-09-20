import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CreateVerifiedSignRequest,
  UpdateVerifiedSign,
  VerifiedSignStatus,
} from '../../domain/verified-sign';

export class CreateVerifiedSignDto implements CreateVerifiedSignRequest {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  signTypeId: number;

  @IsUUID()
  originCandidateId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(359.999999)
  trafficDirection?: number | null;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  signCropUrl: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date())
  lastVerifiedAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  communeCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  roadName?: string | null;

  @IsOptional()
  @IsString()
  displayAddress?: string | null;
}

export class UpdateVerifiedSignDto implements UpdateVerifiedSign {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  signTypeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(359.999999)
  trafficDirection?: number | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  signCropUrl?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date())
  lastVerifiedAt?: Date;

  @IsOptional()
  @IsEnum(VerifiedSignStatus)
  status?: VerifiedSignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  communeCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  roadName?: string | null;

  @IsOptional()
  @IsString()
  displayAddress?: string | null;
}
