import { IsString, IsOptional, IsNumber, Min, Max, IsInt, IsISO8601, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SubmitEvidenceDto {
  // One of mediaUrl (already uploaded) OR file upload via multipart; DTO keeps non-file fields
  @ApiPropertyOptional({ description: 'Pre-uploaded media URL (if not using multipart file upload)' })
  @IsOptional() @IsString() mediaUrl?: string;

  @ApiProperty({ description: 'Latitude of surveyor at capture time', example: 10.77689 })
  @Type(() => Number)
  @IsNumber() @Min(-90) @Max(90) latitude: number;

  @ApiProperty({ description: 'Longitude of surveyor at capture time', example: 106.7009 })
  @Type(() => Number)
  @IsNumber() @Min(-180) @Max(180) longitude: number;

  @ApiPropertyOptional({ description: 'ISO 8601 capture timestamp', example: '2026-11-05T08:00:00.000Z' })
  @IsOptional() @IsISO8601() capturedAt?: string;

  @ApiPropertyOptional({ enum: ['STILL_ACTIVE', 'REMOVED', 'CHANGED'], default: 'STILL_ACTIVE', description: 'Surveyor on-site observation' })
  @IsOptional() @IsIn(['STILL_ACTIVE', 'REMOVED', 'CHANGED']) evidenceType?: string;

  @ApiPropertyOptional({ description: 'Suggested replacement sign type ID if changed', example: 12 })
  @IsOptional() @IsInt() suggestedSignTypeId?: number;

  @ApiPropertyOptional({ description: 'Whether evidence was captured directly on-site using live camera', default: false, example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLiveCapture?: boolean;

  @ApiPropertyOptional({ description: 'Horizontal GPS accuracy in meters reported by device', example: 4.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @ApiPropertyOptional({ description: 'Compass heading angle in degrees (0 - 360) facing the sign', example: 185.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  headingDegrees?: number;
}

export class CheckInEligibilityDto {
  @ApiProperty({ description: 'Current latitude of surveyor', example: 10.77689 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Current longitude of surveyor', example: 106.7009 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Current horizontal GPS accuracy in meters', example: 5.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;
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

export class EarlyClassifyDto {
  @IsOptional() @IsString() mediaUrl?: string;
}

export class RequestEvidenceRecaptureDto {
  @IsString() reason: string;
  @IsOptional() @IsString() note?: string;
}
