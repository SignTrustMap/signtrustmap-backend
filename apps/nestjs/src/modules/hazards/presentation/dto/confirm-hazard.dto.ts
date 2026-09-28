import { IsEnum, IsNumber, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HazardVoteType } from '../../infrastructure/persistence/hazard-confirmation.entity';

export class ConfirmHazardDto {
  @ApiProperty({ description: 'Vote decision for roadside hazard', enum: HazardVoteType, example: HazardVoteType.CONFIRM })
  @IsEnum(HazardVoteType)
  voteType: HazardVoteType;

  @ApiPropertyOptional({ description: 'Reviewer current latitude coordinate', example: 10.7769 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Reviewer current longitude coordinate', example: 106.7009 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
