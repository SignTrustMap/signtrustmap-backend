import { IsString, IsOptional, IsNumber, Min, Max, IsInt, IsISO8601, IsIn } from 'class-validator';
export class SubmitEvidenceDto {
  // One of mediaUrl (already uploaded) OR file upload via multipart; DTO keeps non-file fields
  @IsOptional() @IsString() mediaUrl?: string;
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsOptional() @IsISO8601() capturedAt?: string;
  @IsOptional() @IsIn(['STILL_ACTIVE', 'REMOVED']) evidenceType?: string;
}
export class EvidenceVoteDto {
  @IsString() decision: string;
  @IsOptional() @IsInt() suggestedSignTypeId?: number;
  @IsOptional() @IsString() note?: string;
}
export class EvidenceQueryDto {
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize?: number;
}
