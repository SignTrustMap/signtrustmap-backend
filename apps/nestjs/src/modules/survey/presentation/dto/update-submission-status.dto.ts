import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MediaFileType } from '../../domain/submission-contract';
import { SubmissionStatus } from '../../infrastructure/persistence/survey-submission.entity';

export class SubmissionIssueDto {
  @ApiProperty({ description: 'Issue error code', example: 'BLURRY_IMAGE' })
  @IsString()
  @MaxLength(100)
  code: string;

  @ApiProperty({ description: 'Field or resource name with issue', example: 'frames[0].image' })
  @IsString()
  @MaxLength(200)
  field: string;

  @ApiProperty({ description: 'Detailed issue explanation' })
  @IsString()
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ enum: MediaFileType, description: 'Type of media involved' })
  @IsOptional()
  @IsEnum(MediaFileType)
  mediaType?: MediaFileType;
}

export class UpdateSubmissionStatusDto {
  @ApiProperty({ enum: SubmissionStatus, description: 'Target pipeline state' })
  @IsEnum(SubmissionStatus)
  status: SubmissionStatus;

  @ApiPropertyOptional({ description: 'Processing note or status detail' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ type: () => [SubmissionIssueDto], description: 'Validation errors encountered' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionIssueDto)
  validationErrors?: SubmissionIssueDto[];

  @ApiPropertyOptional({ type: () => [SubmissionIssueDto], description: 'Correction requirements for surveyor' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionIssueDto)
  correctionRequirements?: SubmissionIssueDto[];
}

export class MarkSubmissionCompletedDto {
  @ApiPropertyOptional({ description: 'Optional completion note', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
