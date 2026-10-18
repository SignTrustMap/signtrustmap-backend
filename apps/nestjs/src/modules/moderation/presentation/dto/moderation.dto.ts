import { IsString, IsOptional, IsUUID, IsInt, MaxLength, MinLength } from 'class-validator';
export class CreateMissingTypeReportDto {
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsInt() proposedCategoryId?: number;
  @IsString() @MaxLength(255) proposedName: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedShape?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedColorScheme?: string;
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

export class ApproveAndCreateTypeDto {
  @IsOptional() @IsInt() proposedCategoryId?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50) signCode?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameVi?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedShape?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedColorScheme?: string;
  @IsOptional() @IsString() @MaxLength(1000) aiLabelPrompt?: string;
  @IsOptional() @IsString() @MaxLength(500) representativeImageKey?: string;
  @IsOptional() @IsString() staffNotes?: string;
}