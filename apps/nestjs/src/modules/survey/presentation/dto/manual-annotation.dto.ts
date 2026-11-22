import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BoundingBoxDto {
  @ApiProperty({ description: 'Normalized xmin coordinate (0.0 to 1.0)', example: 0.25 })
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  xmin: number;

  @ApiProperty({ description: 'Normalized ymin coordinate (0.0 to 1.0)', example: 0.30 })
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  ymin: number;

  @ApiProperty({ description: 'Normalized xmax coordinate (0.0 to 1.0)', example: 0.45 })
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  xmax: number;

  @ApiProperty({ description: 'Normalized ymax coordinate (0.0 to 1.0)', example: 0.60 })
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  ymax: number;

  @ApiPropertyOptional({ description: 'Source image pixel width', example: 1920 })
  @IsOptional()
  @IsInt()
  imgWidth?: number;

  @ApiPropertyOptional({ description: 'Source image pixel height', example: 1080 })
  @IsOptional()
  @IsInt()
  imgHeight?: number;
}

export class SubmitManualAnnotationDto {
  @ApiProperty({ description: 'Media file UUID from the survey submission', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  mediaFileId: string;

  @ApiProperty({ description: 'Catalog traffic sign type ID selected by surveyor', example: 102 })
  @IsInt()
  @IsNotEmpty()
  signTypeId: number;

  @ApiProperty({ description: 'Drawn bounding box coordinates', type: () => BoundingBoxDto })
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  @IsNotEmpty()
  boundingBox: BoundingBoxDto;

  @ApiPropertyOptional({ description: 'Optional operational notes from surveyor', example: 'Sign is partially hidden by tree' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ConfirmNegativeSubmissionDto {
  @ApiPropertyOptional({ description: 'Surveyor confirmation note', example: 'Confirmed no signs in frame' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
