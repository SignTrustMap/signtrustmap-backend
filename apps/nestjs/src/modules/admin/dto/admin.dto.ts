import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, MaxLength, IsBoolean, IsNumber, IsInt, Min, Max, IsObject } from 'class-validator';
import { RulePriority } from '../../revalidation/infrastructure/persistence/freshness-rule.entity';

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED'], description: 'Target user status' })
  @IsEnum(['ACTIVE', 'SUSPENDED', 'BANNED'] as any)
  status: string;

  @ApiPropertyOptional({ description: 'Reason for status update', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignRoleDto {
  @ApiProperty({ description: 'Role code to assign (e.g. SURVEYOR, REVIEWER, ADMIN)', maxLength: 30 })
  @IsString()
  @MaxLength(30)
  roleCode: string;

  @ApiPropertyOptional({ description: 'Role active flag', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export { ManualAdjustmentDto, FreezeWalletDto } from '../../wallet/presentation/dto/wallet.dto';

export class UpdateConsensusConfigDto {
  @ApiPropertyOptional({ description: 'Approval threshold ratio', example: 0.66 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  approvalThreshold?: number;

  @ApiPropertyOptional({ description: 'Rejection threshold ratio', example: 0.33 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rejectionThreshold?: number;

  @ApiPropertyOptional({ description: 'Minimum votes required for consensus', example: 3, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  minVotesRequired?: number;

  @ApiPropertyOptional({ description: 'Maximum reviewer votes allowed per task', example: 9, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxVotesLimit?: number;

  @ApiPropertyOptional({ description: 'Alpha smoothing factor' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  alphaSmoothingFactor?: number;

  @ApiPropertyOptional({ description: 'Weight for correct votes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightCorrect?: number;

  @ApiPropertyOptional({ description: 'Penalty for false votes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  penaltyFalse?: number;

  @ApiPropertyOptional({ description: 'Minimum sample baseline' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSampleBaseline?: number;

  @ApiPropertyOptional({ description: 'Minimum reliability threshold percentage' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minReliabilityThreshold?: number;

  @ApiPropertyOptional({ description: 'Consecutive error limit before suspension' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  consecutiveErrorLimit?: number;

  @ApiPropertyOptional({ description: 'Suspension cooldown in days' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  suspensionCooldownDays?: number;

  @ApiPropertyOptional({ description: 'Provisional vote weight' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  provisionalVoteWeight?: number;

  @ApiPropertyOptional({ description: 'Audit reason for config change', maxLength: 500 })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateRouteMatrixDto {
  @ApiPropertyOptional({ description: 'Road classification type (e.g. URBAN, HIGHWAY)' })
  @IsOptional()
  @IsString()
  roadType?: string;

  @ApiPropertyOptional({ description: 'Default lifetime in days', example: 90, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  defaultLifetimeDays?: number;

  @ApiPropertyOptional({ description: 'Revalidation threshold in days', example: 30, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  revalidationThresholdDays?: number;

  @ApiPropertyOptional({ description: 'Spatial buffer in meters', example: 25, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  spatialBufferMeters?: number;

  @ApiPropertyOptional({ description: 'Audit reason for matrix update' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class TriggerRetrainDto {
  @ApiPropertyOptional({ description: 'Model architecture type (e.g. YOLO26, TRACKER, CLIP)', example: 'YOLO26' })
  @IsOptional()
  @IsString()
  modelType?: string;

  @ApiPropertyOptional({ description: 'Custom model version or identifier' })
  @IsOptional()
  @IsString()
  modelName?: string;

  @ApiPropertyOptional({ description: 'Train/validation split ratio (e.g. 0.8)', example: 0.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  datasetSplitRatio?: number;

  @ApiPropertyOptional({ description: 'Retraining job notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Minimum approved sample threshold' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSampleThreshold?: number;
}

export class ActiveLearningConfigDto {
  @ApiPropertyOptional({ description: 'Uncertainty margin threshold' })
  @IsOptional()
  @IsString()
  uncertaintyMargin?: string;

  @ApiPropertyOptional({ description: 'Minimum samples required before triggering automatic retrain' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSamplesForAutoRetrain?: number;

  @ApiPropertyOptional({ description: 'Default sample selection strategy' })
  @IsOptional()
  @IsString()
  defaultStrategy?: string;

  @ApiPropertyOptional({ description: 'Default top-K items to query' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultTopK?: number;
}

export class CreateFreshnessRuleDto {
  @ApiPropertyOptional({ description: 'ID of sign category', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  signCategoryId?: number;

  @ApiProperty({ description: 'Freshness period in days before sign becomes stale', example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  freshnessPeriodDays: number;

  @ApiPropertyOptional({ enum: RulePriority, description: 'Default task priority', default: RulePriority.MEDIUM })
  @IsOptional()
  @IsEnum(RulePriority)
  defaultPriority?: RulePriority;

  @ApiPropertyOptional({ description: 'Maximum GPS proximity distance in metres', default: 50, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(500)
  maxProximityMeters?: number;

  @ApiPropertyOptional({ description: 'Maximum evidence submissions per task in 24 hours', default: 3, example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  dailySubmissionLimit?: number;

  @ApiPropertyOptional({ description: 'Whether this freshness rule is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Audit reason for rule creation', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateFreshnessRuleDto {
  @ApiPropertyOptional({ description: 'ID of sign category', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  signCategoryId?: number;

  @ApiPropertyOptional({ description: 'Freshness period in days before sign becomes stale', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  freshnessPeriodDays?: number;

  @ApiPropertyOptional({ enum: RulePriority, description: 'Default task priority' })
  @IsOptional()
  @IsEnum(RulePriority)
  defaultPriority?: RulePriority;

  @ApiPropertyOptional({ description: 'Maximum GPS proximity distance in metres', example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(500)
  maxProximityMeters?: number;

  @ApiPropertyOptional({ description: 'Maximum evidence submissions per task in 24 hours', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  dailySubmissionLimit?: number;

  @ApiPropertyOptional({ description: 'Whether this freshness rule is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Audit reason for rule update', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateRewardRuleDto {
  @ApiPropertyOptional({ description: 'Base reward amount in credits', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseAmount?: number;

  @ApiPropertyOptional({ description: 'Daily limit of reward disbursements per user', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailyLimit?: number;

  @ApiPropertyOptional({ description: 'Multiplier config as JSON object', example: { urgency_bonus: true } })
  @IsOptional()
  @IsObject()
  multiplierConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Whether this reward rule is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Audit reason for reward rule update', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateSystemFeatureFlagDto {
  @ApiProperty({ description: 'Whether the feature flag is enabled' })
  @IsBoolean()
  isEnabled: boolean;

  @ApiPropertyOptional({ description: 'Optional metadata parameters (e.g. targetEmail)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Audit reason for toggle change', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DemoModeToggleDto {
  @ApiPropertyOptional({ description: 'Target surveyor email for auto-assigning recaptures in demo mode', example: 'demo@stm.dev' })
  @IsOptional()
  @IsString()
  targetEmail?: string;

  @ApiPropertyOptional({ description: 'Audit reason', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export * from './user-statistics.dto';



