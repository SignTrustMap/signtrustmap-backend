import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class VoteDto {
  @IsIn([1, -1], { message: 'vote must be 1 (approve) or -1 (reject)' })
  vote: number;

  @IsOptional()
  @IsInt({ message: 'suggestedSignTypeId must be an integer' })
  suggestedSignTypeId?: number;

  /** Reason category when vote = -1  (maps to Decline Reason sheet) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declineReason?: string;

  /** Free-text note when declineReason = 'Other' */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declineNote?: string;
}

export class ReportDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class RequestRecaptureDto {
  @IsString()
  @MaxLength(100)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class SubmitRecaptureDto {
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class SelectSignRemedyDto {
  @Type(() => Number)
  @IsInt({ message: 'signTypeId must be an integer' })
  signTypeId: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TestReviewDto {
  @IsString()
  candidateId: string;

  @IsOptional()
  @IsString()
  reviewerId?: string;

  @IsIn([1, -1], { message: 'vote must be 1 (approve) or -1 (reject)' })
  vote: number;

  @IsOptional()
  @IsInt({ message: 'suggestedSignTypeId must be an integer' })
  suggestedSignTypeId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  declineReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  declineNote?: string;
}

export class TestAssignDto {
  @IsOptional()
  @IsString()
  reviewerId?: string;

  @IsOptional()
  candidateIds?: string[];
}
