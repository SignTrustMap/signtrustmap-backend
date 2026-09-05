import { IsString, IsEnum, IsNumber, IsOptional, Min, MaxLength, IsInt } from 'class-validator';
import { MediaFileType } from '../../../entities/submission-media-file.entity';

export class InitializeUploadDto {
  @IsString()
  @MaxLength(500)
  originalFilename: string;

  @IsEnum(MediaFileType)
  mediaType: MediaFileType;

  @IsNumber()
  @Min(1)
  totalSizeBytes: number;

  @IsInt()
  @Min(1)
  totalChunks: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksumExpected?: string;
}
