import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DetectionBox,
  SignGeolocationMethod,
  SignGeolocationRequest,
  SignGeolocationResponse,
  SignObservation,
} from '../../domain/sign-geolocation';

export class DetectionBoxDto implements DetectionBox {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  xMin: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  yMin: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  xMax: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  yMax: number;
}

export class SignObservationDto implements SignObservation {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  cameraLatitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  cameraLongitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(359.999999)
  cameraBearingDegrees: number;

  @ValidateNested()
  @Type(() => DetectionBoxDto)
  detectionBox: DetectionBoxDto;
}

export class SignGeolocationRequestDto implements SignGeolocationRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SignObservationDto)
  observations: SignObservationDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(179)
  horizontalFieldOfViewDegrees?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100_000)
  imageWidthPixels?: number;
}

export class SignGeolocationResponseDto implements SignGeolocationResponse {
  @ApiProperty()
  latitude: number;

  @ApiProperty()
  longitude: number;

  @ApiProperty()
  averageDistanceMeters: number;

  @ApiProperty()
  estimatedSignHeightMeters: number;

  @ApiProperty({ enum: SignGeolocationMethod })
  method: SignGeolocationMethod;

  @ApiProperty()
  observationCount: number;
}
