import { IsString, IsEnum, IsNumber, IsOptional, Min, Max, MaxLength, IsInt } from 'class-validator';
import { MediaFileType } from '../../infrastructure/persistence/submission-media-file.entity';

export class InitializeUploadDto {
  @IsString()
  @MaxLength(500)
  originalFilename: string;

  @IsEnum(MediaFileType)
  mediaType: MediaFileType;

  @IsNumber()
  @Min(1)
  @Max(2 * 1024 * 1024 * 1024) // 2 GB max
  totalSizeBytes: number;

  @IsInt()
  @Min(1)
  @Max(5000) // 5000 chunks max
  totalChunks: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksumExpected?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
