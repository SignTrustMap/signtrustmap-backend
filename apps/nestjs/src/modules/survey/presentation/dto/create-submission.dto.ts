import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @MaxLength(2000)
  note?: string;
}
