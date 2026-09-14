import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ConfirmSignDto {
  @ApiProperty({
    description: 'Whether the sign is physically present at the reported location',
    example: true,
  })
  @IsBoolean()
  isPresent: boolean;

  @ApiPropertyOptional({
    description: 'GPS latitude of the surveyor/driver at confirmation time',
    example: 10.7725,
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    description: 'GPS longitude of the surveyor/driver at confirmation time',
    example: 106.698,
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'MinIO storage key or URL for photo evidence of the sign or missing pole',
    example: 'revalidation/evidence/sign-photo.jpg',
  })
  @IsOptional()
  @IsString()
  photoEvidenceUrl?: string;

  @ApiPropertyOptional({
    description: 'Surveyor note or dispute explanation',
    example: 'Sign is clear, clean, and positioned properly on the right shoulder.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
