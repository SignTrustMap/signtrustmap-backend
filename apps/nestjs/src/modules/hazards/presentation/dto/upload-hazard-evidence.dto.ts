import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadHazardEvidenceDto {
  @ApiProperty({ enum: ['IMAGE', 'VIDEO'], example: 'IMAGE' })
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType: 'IMAGE' | 'VIDEO';
}
