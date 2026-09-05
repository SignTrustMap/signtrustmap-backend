import { IsString, IsOptional, IsNumber } from 'class-validator';
export class SubmitEvidenceDto {
  // One of mediaUrl (already uploaded) OR file upload via multipart; DTO keeps non-file fields
  @IsOptional() @IsString() mediaUrl?: string;
  @IsNumber() latitude: number;
  @IsNumber() longitude: number;
}
export class EvidenceVoteDto {
  @IsString() decision: string;
  @IsOptional() @IsString() note?: string;
}
