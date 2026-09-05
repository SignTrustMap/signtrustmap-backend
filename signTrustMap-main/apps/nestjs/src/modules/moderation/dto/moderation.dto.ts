import { IsString, IsOptional, IsUUID, IsInt, MaxLength } from 'class-validator';
export class CreateMissingTypeReportDto {
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsInt() proposedCategoryId?: number;
  @IsString() @MaxLength(255) proposedName: string;
  @IsOptional() @IsString() description?: string;
}
export class ResolveCaseDto {
  @IsString() resolutionNote: string;
  @IsOptional() @IsString() actionType?: string;
  @IsOptional() @IsString() actionNote?: string;
  @IsOptional() @IsUUID() reportId?: string;
  @IsOptional() @IsInt() targetSignTypeId?: number;
  @IsOptional() @IsInt() mergedIntoSignTypeId?: number;
}
export class UpdateMissingTypeReportDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() mergedSignTypeId?: number;
  @IsOptional() @IsInt() mergedIntoSignTypeId?: number;
  @IsOptional() @IsString() staffNotes?: string;
  @IsOptional() @IsString() actionNote?: string;
}