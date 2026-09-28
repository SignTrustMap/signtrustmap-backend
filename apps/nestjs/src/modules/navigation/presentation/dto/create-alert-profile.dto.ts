import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAlertProfileDto {
  @ApiProperty({ description: 'User-friendly name for custom alert profile', example: 'Highway Radar Alert' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Optional description of profile' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Custom rule configuration in JSON format', example: { categories: ['SPEED_LIMIT'], speedThresholdKmh: 60 } })
  @IsObject()
  filterRules: Record<string, any>;
}
