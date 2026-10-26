import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

export class SetActiveLearningPriorityDto {
  @ApiProperty({ description: 'Active learning priority score (0.0 to 1.0)', example: 0.85 })
  @Type(() => Number)
  @IsNumber()
  priority: number;
}

export class BulkPriorityItemDto {
  @ApiProperty({ description: 'Candidate UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  candidateId: string;

  @ApiProperty({ description: 'Active learning priority score (0.0 to 1.0)', example: 0.85 })
  @Type(() => Number)
  @IsNumber()
  priority: number;
}

export class SetBulkActiveLearningPrioritiesDto {
  @ApiProperty({ type: [BulkPriorityItemDto], description: 'List of candidate priorities to update' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkPriorityItemDto)
  items: BulkPriorityItemDto[];
}

export class ReviewQueueQueryDto {
  @ApiProperty({ required: false, default: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 20, description: 'Page size (1-100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiProperty({ required: false, default: false, description: 'Whether to include own submitted candidates' })
  @IsOptional()
  includeOwnSubmissions?: string | boolean;
}

