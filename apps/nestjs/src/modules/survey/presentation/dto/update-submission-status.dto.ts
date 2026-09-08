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
  @IsString()
  @MaxLength(100)
  code: string;

  @IsString()
  @MaxLength(200)
  field: string;

  @IsString()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsEnum(MediaFileType)
  mediaType?: MediaFileType;
}

export class UpdateSubmissionStatusDto {
  @IsEnum(SubmissionStatus)
  status: SubmissionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionIssueDto)
  validationErrors?: SubmissionIssueDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionIssueDto)
  correctionRequirements?: SubmissionIssueDto[];
}
