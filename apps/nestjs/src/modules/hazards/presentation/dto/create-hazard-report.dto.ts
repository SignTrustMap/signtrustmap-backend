import { IsString, IsNotEmpty, IsNumber, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHazardReportDto {
  @ApiProperty({ description: 'Type of road hazard (e.g. SPEED_CHECK, POTHOLE, ACCIDENT, OBSTACLE, ROAD_WORK)', example: 'SPEED_CHECK' })
  @IsString()
  @IsNotEmpty()
  hazardType: string;

  @ApiProperty({ description: 'Latitude coordinate of the hazard', example: 10.7769 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate of the hazard', example: 106.7009 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Optional textual description or landmark notes', example: 'Mobile radar speed trap near toll booth' })
  @IsOptional()
  @IsString()
  description?: string;
}
