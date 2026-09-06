import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadChunkBodyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkIndex: number;

  @IsOptional()
  @IsString()
  checksum?: string;
}
