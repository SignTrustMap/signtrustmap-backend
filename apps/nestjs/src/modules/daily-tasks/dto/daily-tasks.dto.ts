import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class DailyTasksRolloverDto {
  @ApiPropertyOptional({
    description: 'Target UTC rollover date in YYYY-MM-DD format (defaults to yesterday)',
    example: '2026-10-25',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
