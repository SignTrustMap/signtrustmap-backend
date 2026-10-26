import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: 'Category ID', example: 1 })
  @IsOptional() @IsInt() proposedCategoryId?: number;

  @ApiProperty({
    description: 'Traffic sign code (e.g. P.102, W.201a, or T.xxx for testing)',
    pattern: '^(?:[A-Za-z]+\\.\\s*\\d+[A-Za-z0-9]*|T\\.[A-Za-z0-9._-]+)$',
    example: 'T.xxx',
  })
  @IsString()
  @Matches(/^(?:[A-Za-z]+\.\s*\d+[A-Za-z0-9]*|T\.[A-Za-z0-9._-]+)$/i, {
    message: 'signCode must match PREFIX.number (e.g. P.102) or T.xxx for testing',
  })
  @MaxLength(50)
  signCode: string;

  @ApiPropertyOptional({ description: 'Vietnamese name', example: 'Biển thử nghiệm' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameVi?: string;

  @ApiPropertyOptional({ description: 'English name', example: 'Testing Sign' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) nameEn?: string;

  @ApiPropertyOptional({ description: 'Sign description' })
  @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @ApiPropertyOptional({ description: 'Suggested shape', example: 'CIRCLE' })
  @IsOptional() @IsString() @MaxLength(30) suggestedShape?: string;

  @ApiPropertyOptional({ description: 'Suggested color scheme', example: 'RED_WHITE' })
  @IsOptional() @IsString() @MaxLength(30) suggestedColorScheme?: string;

  @ApiPropertyOptional({ description: 'AI prompt for labeling' })
  @IsOptional() @IsString() @MaxLength(1000) aiLabelPrompt?: string;

  @ApiProperty({
    description: 'Allowed vehicle types',
    example: ['CAR', 'MOTORCYCLE'],
    enum: VEHICLE_TYPES,
    isArray: true,
  })
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

  @ApiPropertyOptional({ description: 'Staff moderation notes' })
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