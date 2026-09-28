import { IsString, IsNotEmpty, IsInt, Min, IsOptional, IsBoolean, IsObject, IsISO8601 } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRewardRuleDto {
  @ApiProperty({ description: 'Transaction / activity type matching gamification ledger events', example: 'SURVEY_REWARD' })
  @IsString()
  @IsNotEmpty()
  activityType: string;

  @ApiProperty({ description: 'Base reward credit amount', example: 15 })
  @IsInt()
  @Min(0)
  baseAmount: number;

  @ApiProperty({ description: 'Maximum allowed reward claims per user per UTC day', example: 20 })
  @IsInt()
  @Min(1)
  dailyLimit: number;

  @ApiPropertyOptional({ description: 'Dynamic multiplier hooks (e.g. reputation_bonus, candidate_multiplier)', example: { candidate_multiplier: true, bonus_per_candidate: 5 } })
  @IsOptional()
  @IsObject()
  multiplierConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Whether this reward rule is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Effective start timestamp (ISO8601)' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'Effective end timestamp (ISO8601)' })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}

export class UpdateRewardRuleDto {
  @ApiPropertyOptional({ description: 'Base reward credit amount', example: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  baseAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum allowed reward claims per user per UTC day', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyLimit?: number;

  @ApiPropertyOptional({ description: 'Dynamic multiplier hooks' })
  @IsOptional()
  @IsObject()
  multiplierConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Whether this reward rule is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Effective start timestamp (ISO8601)' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'Effective end timestamp (ISO8601)' })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}
