import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CoordinateSource, SubmissionType } from '../../domain/submission-contract';

export class CreateSubmissionDto {
  @IsEnum(SubmissionType)
  submissionType: SubmissionType;

  @IsISO8601({ strict: true })
  capturedAt: string;

  @IsEnum(CoordinateSource)
  coordinateSource: CoordinateSource;

  @IsOptional()
  @IsString()
  cameraProfileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

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
