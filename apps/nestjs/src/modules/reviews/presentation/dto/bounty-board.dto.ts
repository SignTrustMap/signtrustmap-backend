import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { QuestTargetType } from '../../infrastructure/persistence/reviewer-quest-claim.entity';

export class ClaimQuestDto {
  @ApiProperty({
    description: 'Target quest verification type',
    enum: QuestTargetType,
    example: QuestTargetType.CANDIDATE_VALIDATION,
  })
  @IsEnum(QuestTargetType)
  @IsNotEmpty()
  targetType: QuestTargetType;

  @ApiProperty({
    description: 'Target UUID (either unverified candidate ID or revalidation task ID)',
    example: '6ba661d2-d5b3-48df-bbf7-919d4816bffd',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  targetId: string;
}

export class QueryAvailableQuestsDto {
  @ApiPropertyOptional({ description: 'Reviewer current latitude (-90 to 90)', example: 21.0285 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Reviewer current longitude (-180 to 180)', example: 105.8542 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Proximity search radius in kilometers (defaults to reviewer.promotion_nearby_radius_km, default 10.0)',
    example: 10.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(100)
  radiusKm?: number;

  @ApiPropertyOptional({
    description: 'Filter by target quest type',
    enum: QuestTargetType,
    example: QuestTargetType.CANDIDATE_VALIDATION,
  })
  @IsOptional()
  @IsEnum(QuestTargetType)
  targetType?: QuestTargetType;
}

export class AbandonQuestDto {
  @ApiPropertyOptional({
    description: 'Optional reason for abandoning the active quest claim',
    example: 'Road blocked due to construction',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateVoteDto {
  @ApiProperty({
    description: 'Vote value: 1 for APPROVE, -1 for REJECT',
    enum: [1, -1],
    example: 1,
  })
  @IsIn([1, -1], { message: 'vote must be 1 (approve) or -1 (reject)' })
  vote: number;

  @ApiPropertyOptional({
    description: 'Corrected traffic sign type ID when vote is -1 or suggesting reclassification',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  suggestedSignTypeId?: number;

  @ApiPropertyOptional({
    description: 'Reason for rejecting candidate (when vote = -1)',
    example: 'Incorrect Location',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declineReason?: string;

  @ApiPropertyOptional({
    description: 'Detailed note explaining rejection or amendment',
    example: 'Sign is obscured by tree branches',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declineNote?: string;
}

export class CheckInCandidateDto {
  @ApiProperty({ description: 'Current latitude of reviewer', example: 10.77689 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Current longitude of reviewer', example: 106.7009 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Current horizontal GPS accuracy in meters reported by device', example: 5.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;
}
