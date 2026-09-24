import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CoordinateSource } from '../../domain/submission-contract';

export class UpdateSubmissionDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  capturedAt?: string;

  @IsOptional()
  @IsEnum(CoordinateSource)
  coordinateSource?: CoordinateSource;

  @IsOptional()
  @IsString()
  cameraProfileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
