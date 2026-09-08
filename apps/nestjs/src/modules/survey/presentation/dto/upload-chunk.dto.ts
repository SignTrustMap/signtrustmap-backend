import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadChunkBodyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  chunkIndex: number;

  @IsOptional()
  @IsString()
  checksum?: string;
}
