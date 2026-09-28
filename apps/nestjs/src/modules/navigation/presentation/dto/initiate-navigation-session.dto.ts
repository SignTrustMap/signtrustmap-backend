import { IsNumber, Min, Max, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CoordinatesDto {
  @ApiProperty({ description: 'Latitude coordinate', example: 10.7769 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate', example: 106.7009 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class InitiateNavigationSessionDto {
  @ApiProperty({ description: 'Origin coordinates' })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  origin: CoordinatesDto;

  @ApiProperty({ description: 'Destination coordinates' })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  destination: CoordinatesDto;

  @ApiPropertyOptional({ description: 'Vehicle type (e.g. CAR, MOTORCYCLE, TRUCK)', example: 'CAR' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional({ description: 'Optional client idempotency key to prevent double deduction' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
