import { IsString, IsNotEmpty, IsOptional, IsObject, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAlertProfileDto {
  @ApiProperty({ description: 'User-friendly name for custom alert profile', example: 'Highway Radar Alert', maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ description: 'Optional description of profile', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Custom rule configuration in JSON format', example: { categories: ['SPEED_LIMIT'], speedThresholdKmh: 60 } })
  @IsObject()
  filterRules: Record<string, any>;
}
