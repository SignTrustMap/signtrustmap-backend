import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePresignedUrlDto {
  @ApiProperty({
    description: 'Target media type for the presigned upload URL',
    enum: ['VIDEO', 'GPX', 'IMAGE'],
    example: 'VIDEO',
  })
  @IsNotEmpty()
  @IsIn(['VIDEO', 'GPX', 'IMAGE'])
  mediaType: 'VIDEO' | 'GPX' | 'IMAGE';

  @ApiPropertyOptional({
    description: 'Original client filename',
    example: 'dashcam_20261002.mp4',
  })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiPropertyOptional({
    description: 'MIME content type of the file',
    example: 'video/mp4',
  })
  @IsOptional()
  @IsString()
  contentType?: string;
}
