import { IsString, IsOptional, IsEnum, MaxLength, IsBoolean, IsNumber, Min } from 'class-validator';

export class UpdateUserStatusDto {
  @IsEnum(['ACTIVE', 'SUSPENDED', 'BANNED'] as any)
  status: string;
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
export class AssignRoleDto {
  @IsString()
  @MaxLength(30)
  roleCode: string;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export { ManualAdjustmentDto, FreezeWalletDto } from '../../wallet/presentation/dto/wallet.dto';

export class UpdateConsensusConfigDto {
  @IsOptional()
  @IsNumber()
  approvalThreshold?: number;

  @IsOptional()
  @IsNumber()
  rejectionThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minVotesRequired?: number;

  @IsOptional()
  @IsNumber()
  alphaSmoothingFactor?: number;

  @IsOptional()
  @IsNumber()
  weightCorrect?: number;

  @IsOptional()
  @IsNumber()
  penaltyFalse?: number;

  @IsOptional()
  @IsNumber()
  minSampleBaseline?: number;

  @IsOptional()
  @IsNumber()
  minReliabilityThreshold?: number;

  @IsOptional()
  @IsNumber()
  consecutiveErrorLimit?: number;

  @IsOptional()
  @IsNumber()
  suspensionCooldownDays?: number;

  @IsOptional()
  @IsNumber()
  provisionalVoteWeight?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateRouteMatrixDto {
  @IsOptional()
  @IsString()
  roadType?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  defaultLifetimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  revalidationThresholdDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  spatialBufferMeters?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class TriggerRetrainDto {
  @IsOptional()
  @IsString()
  modelType?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsNumber()
  datasetSplitRatio?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  minSampleThreshold?: number;
}

export class ActiveLearningConfigDto {
  @IsOptional()
  @IsString()
  uncertaintyMargin?: string;

  @IsOptional()
  @IsNumber()
  minSamplesForAutoRetrain?: number;

  @IsOptional()
  @IsString()
  defaultStrategy?: string;

  @IsOptional()
  @IsNumber()
  defaultTopK?: number;
}



