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
