import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, IsOptional, IsUUID, IsInt, IsIn, Matches, MaxLength, MinLength } from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../../common/vehicle-types';
export class CreateMissingTypeReportDto {
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsInt() proposedCategoryId?: number;
  @IsOptional() @IsString() @MaxLength(255) proposedName?: string;
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
  @IsOptional() @IsIn(['MERGE', 'REJECT', 'REQUEST_RECAPTURE', 'ESCALATE_ADMIN']) actionType?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() mergedSignTypeId?: number;
  @IsOptional() @IsInt() mergedIntoSignTypeId?: number;
  @IsOptional() @IsString() staffNotes?: string;
  @IsOptional() @IsString() actionNote?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedShape?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedColorScheme?: string;
}

export class ApproveAndCreateTypeDto {
  @IsOptional() @IsInt() proposedCategoryId?: number;
  @IsString() @Matches(/^[A-Za-z]+\.\s*\d+[A-Za-z0-9]*$/) @MaxLength(50) signCode: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameVi?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedShape?: string;
  @IsOptional() @IsString() @MaxLength(30) suggestedColorScheme?: string;
  @IsOptional() @IsString() @MaxLength(1000) aiLabelPrompt?: string;
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return value;
    }
    return value.split(',').map((vehicle) => vehicle.trim()).filter(Boolean);
  })
  @IsArray() @ArrayMinSize(1) @IsIn(VEHICLE_TYPES, { each: true }) allowedVehicles: VehicleType[];
  @IsOptional() @IsString() staffNotes?: string;
}

export class AdminMissingTypeActionDto {
  @IsIn(['REJECT', 'REQUEST_RECAPTURE', 'BAN_USER'])
  actionType: string;

  @IsString() @MinLength(1) @MaxLength(500)
  reason: string;

  @IsOptional() @IsIn(['SURVEYOR', 'REVIEWER', 'STAFF'])
  banTarget?: string;
}