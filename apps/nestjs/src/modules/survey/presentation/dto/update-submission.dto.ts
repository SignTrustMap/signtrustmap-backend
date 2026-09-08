import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @MaxLength(2000)
  note?: string;
}
