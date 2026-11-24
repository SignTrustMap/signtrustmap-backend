import { IsString, IsOptional, IsNumber, Min, Max, IsInt, IsISO8601, IsIn, IsBoolean, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

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
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
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

  @ApiPropertyOptional({ description: 'Explicit verified sign ID confirmed by user when nearby signs are ambiguous', example: '42' })
  @IsOptional()
  @IsString()
  confirmedSignId?: string;

  @ApiPropertyOptional({ description: 'Optional associated Bounty Quest Claim ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  questClaimId?: string;
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
  @ApiProperty({ description: 'Reviewer decision on evidence' })
  @IsString() decision: string;
  @ApiPropertyOptional({ description: 'Suggested replacement sign type ID if CHANGED', example: 12 })
  @IsOptional() @IsInt() suggestedSignTypeId?: number;
  @ApiPropertyOptional({ description: 'Reviewer note' })
  @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional({ description: 'Optional associated Bounty Quest Claim ID', format: 'uuid' })
  @IsOptional() @IsUUID() questClaimId?: string;
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

export class ConfirmAmbiguousTargetDto {
  @ApiProperty({ description: 'Confirmed verified traffic sign ID', example: 42 })
  @Type(() => Number)
  @IsInt()
  confirmedSignId: number;

  @ApiPropertyOptional({ description: 'Reviewer or surveyor confirmation note' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateRevalidationTaskDto {
  @ApiProperty({ description: 'Verified traffic sign UUID requiring field revalidation' })
  @IsUUID()
  verifiedSignId: string;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'HIGH', description: 'Task urgency priority' })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';

  @ApiPropertyOptional({ description: 'Bounty reward credits for valid completion', default: 20, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  rewardCredits?: number;

  @ApiPropertyOptional({ description: 'Optional freshness rule ID to govern proximity & daily limits' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  freshnessRuleId?: number;

  @ApiPropertyOptional({ description: 'Days until task expiration', default: 14, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;

  @ApiPropertyOptional({ description: 'Operational reason for creating this manual revalidation task', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ResolveRevalidationTaskDto {
  @ApiProperty({
    enum: ['STILL_ACTIVE', 'UNCHANGED', 'REMOVED', 'MISSING', 'CHANGED', 'INVALID'],
    description: 'Authoritative Staff/Admin verdict for a disputed or escalated revalidation task',
  })
  @IsIn(['STILL_ACTIVE', 'UNCHANGED', 'REMOVED', 'MISSING', 'CHANGED', 'INVALID'])
  decision: 'STILL_ACTIVE' | 'UNCHANGED' | 'REMOVED' | 'MISSING' | 'CHANGED' | 'INVALID';

  @ApiPropertyOptional({ description: 'Required replacement traffic_sign_types ID when decision is CHANGED' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  suggestedSignTypeId?: number;

  @ApiPropertyOptional({ description: 'Staff resolution rationale recorded in moderation_cases and lifecycle events', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
