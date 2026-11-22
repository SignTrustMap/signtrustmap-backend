import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ParameterCategory, ParameterDataType } from '../entities/system-parameter.entity';

export class SystemParameterResponseDto {
  @ApiProperty({
    description: 'Unique parameter key identifier',
    example: 'consensus.approval_threshold',
  })
  key: string;

  @ApiProperty({
    description: 'Current string-serialized parameter value',
    example: '0.5',
  })
  value: string;

  @ApiPropertyOptional({
    description: 'Business and operational description',
    example: 'Approval threshold for consensus',
  })
  description?: string | null;

  @ApiProperty({
    enum: ParameterCategory,
    description: 'Parameter system category',
    example: ParameterCategory.CONSENSUS,
  })
  category: ParameterCategory;

  @ApiProperty({
    description: 'Functional domain the parameter belongs to',
    example: 'CONSENSUS',
  })
  domain: string;

  @ApiProperty({
    description: 'Human-readable functional domain label',
    example: 'Consensus & Voting',
  })
  domainLabel: string;

  @ApiProperty({
    enum: ParameterDataType,
    description: 'Underlying data type',
    example: ParameterDataType.NUMBER,
  })
  dataType: ParameterDataType;

  @ApiProperty({
    description: 'Allowed value range or constraint format for input guidance',
    example: '0.1 - 1.0',
  })
  range: string;

  @ApiProperty({
    description: 'JSON schema validation rules for the parameter',
    example: { min: 0.1, max: 1.0, step: 0.05 },
  })
  validationRules: Record<string, any>;

  @ApiProperty({
    description: 'Whether changing this parameter requires a service restart',
    example: false,
  })
  requiresRestart: boolean;

  @ApiPropertyOptional({
    description: 'UUID of the administrator who last modified this parameter',
    example: '1e6448ea-fdbf-4e4f-bf1b-19b3a2765330',
  })
  updatedBy?: string | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2026-09-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last modification timestamp',
    example: '2026-11-22T16:00:00.000Z',
  })
  updatedAt: Date;
}

export class UpdateSystemParameterDto {
  @ApiProperty({
    description: 'New value of the system parameter formatted as a string',
    example: '55',
  })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({
    description: 'Operational justification for modifying the configuration',
    example: 'Tuning road hazard initial TTL for rush hour traffic',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  changeReason: string;
}

export class RollbackSystemParameterDto {
  @ApiProperty({
    description: 'Target audit log ID whose previous value should be restored',
    example: '142',
  })
  @IsString()
  @IsNotEmpty()
  targetAuditId: string;

  @ApiProperty({
    description: 'Operational justification for the rollback',
    example: 'Reverting accidental threshold change back to stable baseline',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  changeReason: string;
}

export class QuerySystemParametersDto {
  @ApiPropertyOptional({
    description: 'Filter parameters by domain category',
    enum: ParameterCategory,
    example: ParameterCategory.CONSENSUS,
  })
  @IsOptional()
  @IsEnum(ParameterCategory)
  category?: ParameterCategory;

  @ApiPropertyOptional({
    description: 'Search substring filter matching key or description',
    example: 'ttl',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
