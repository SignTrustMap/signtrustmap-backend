import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, MaxLength, IsBoolean, IsNumber, Min } from 'class-validator';

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
  @ApiPropertyOptional({ description: 'Model architecture type (e.g. YOLO12, FEW_SHOT)', example: 'YOLO12' })
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



