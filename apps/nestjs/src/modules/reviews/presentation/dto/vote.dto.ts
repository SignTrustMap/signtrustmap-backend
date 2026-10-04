import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

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
