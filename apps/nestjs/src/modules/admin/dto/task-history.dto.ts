import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';

export class TaskParticipantUserDto {
  @ApiProperty({ description: 'User unique ID', example: 'd3b07384-d113-4c9e-9c7e-8c3b9b4f7384' })
  id: string;

  @ApiProperty({ description: 'Full display name of user', example: 'Nguyen Van A' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Email address of user', example: 'surveyor1@stm.dev' })
  email?: string;

  @ApiPropertyOptional({ description: 'Role of user', example: 'SURVEYOR' })
  role?: string;
}

export class TaskSurveyorRequestItemDto {
  @ApiProperty({ description: 'Request or Evidence record unique ID', example: '9a8b7c6d-1234-5678-90ab-cdef12345678' })
  id: string;

  @ApiProperty({ description: 'Type of request or event', enum: ['RECAPTURE_REQUEST', 'EVIDENCE_SUBMISSION'], example: 'RECAPTURE_REQUEST' })
  type: 'RECAPTURE_REQUEST' | 'EVIDENCE_SUBMISSION';

  @ApiPropertyOptional({ description: 'Status of the request or evidence', example: 'COMPLETED' })
  status?: string;

  @ApiPropertyOptional({ description: 'Reason for recapture request if applicable', example: 'BLURRY' })
  reason?: string;

  @ApiPropertyOptional({ description: 'Instruction note for the surveyor', example: 'Image is blurred, please take a clear shot' })
  note?: string;

  @ApiPropertyOptional({ description: 'Media URL of submitted evidence or reference crop', example: 'https://storage.stm.dev/evidences/photo.jpg' })
  mediaUrl?: string;

  @ApiProperty({ description: 'Surveyor user ID who was assigned or submitted', example: 'd3b07384-d113-4c9e-9c7e-8c3b9b4f7384' })
  surveyorId: string;

  @ApiProperty({ description: 'Surveyor full name', example: 'Nguyen Van A' })
  surveyorName: string;

  @ApiPropertyOptional({ description: 'Surveyor email', example: 'surveyor@stm.dev' })
  surveyorEmail?: string;

  @ApiPropertyOptional({ type: () => TaskParticipantUserDto, description: 'Surveyor user details' })
  surveyor?: TaskParticipantUserDto;

  @ApiPropertyOptional({ description: 'Reviewer/Admin user ID who initiated the request', example: 'e4c18495-e224-4d0f-0d8f-9d4ca0508495' })
  reviewerId?: string;

  @ApiPropertyOptional({ description: 'Reviewer/Admin full name who initiated the request', example: 'Tran Thi B' })
  reviewerName?: string;

  @ApiPropertyOptional({ description: 'Reviewer/Admin email', example: 'reviewer@stm.dev' })
  reviewerEmail?: string;

  @ApiPropertyOptional({ type: () => TaskParticipantUserDto, description: 'Reviewer user details' })
  reviewer?: TaskParticipantUserDto;

  @ApiPropertyOptional({ description: 'Timestamp when request was issued' })
  requestedAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp when evidence was submitted' })
  submittedAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp when request was fulfilled/completed' })
  completedAt?: string;
}

export class TaskReviewItemDto {
  @ApiProperty({ description: 'Review or decision unique ID', example: '10293847' })
  id: string;

  @ApiPropertyOptional({ description: 'Evidence ID that was reviewed (for revalidation task)' })
  evidenceId?: string;

  @ApiPropertyOptional({ description: 'Candidate ID that was reviewed (for candidate review task)' })
  candidateId?: string;

  @ApiProperty({ description: 'Reviewer user ID who performed the evaluation', example: 'e4c18495-e224-4d0f-0d8f-9d4ca0508495' })
  reviewerId: string;

  @ApiProperty({ description: 'Reviewer full name', example: 'Tran Thi B' })
  reviewerName: string;

  @ApiPropertyOptional({ description: 'Reviewer email', example: 'reviewer@stm.dev' })
  reviewerEmail?: string;

  @ApiPropertyOptional({ type: () => TaskParticipantUserDto, description: 'Reviewer user details' })
  reviewer?: TaskParticipantUserDto;

  @ApiPropertyOptional({ description: 'Decision verdict enum (e.g. UNCHANGED, CHANGED, REMOVED, UNCLEAR, INVALID)', example: 'UNCHANGED' })
  decision?: string;

  @ApiPropertyOptional({ description: 'Vote value (+1 approve, -1 reject, 0 skip/unsure)', example: 1 })
  vote?: number;

  @ApiPropertyOptional({ description: 'Reviewer evaluation notes or feedback', example: 'Sign is clearly legible and intact' })
  note?: string;

  @ApiPropertyOptional({ description: 'Decline reason code if rejected', example: 'POOR_IMAGE_QUALITY' })
  declineReason?: string;

  @ApiPropertyOptional({ description: 'Decline note if rejected' })
  declineNote?: string;

  @ApiPropertyOptional({ description: 'Suggested replacement sign type ID if changed', example: 15 })
  suggestedSignTypeId?: number | null;

  @ApiPropertyOptional({ description: 'Timestamp of decision/review' })
  decidedAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp of candidate review' })
  reviewedAt?: string;
}

export class TaskTimelineEventDto {
  @ApiProperty({ description: 'Timeline event unique ID' })
  eventId: string;

  @ApiProperty({ description: 'Type of lifecycle event', enum: ['TASK_CREATED', 'EVIDENCE_SUBMITTED', 'RECAPTURE_REQUESTED', 'REVIEW_DECIDED', 'TASK_FINALIZED'] })
  eventType: string;

  @ApiProperty({ description: 'Event timestamp' })
  timestamp: string;

  @ApiProperty({ type: () => TaskParticipantUserDto, description: 'User actor who performed the action' })
  actor: TaskParticipantUserDto;

  @ApiProperty({ description: 'Human-readable action description', example: 'Surveyor Nguyen Van A submitted evidence' })
  description: string;

  @ApiPropertyOptional({ description: 'Detailed action payload' })
  details?: Record<string, any>;
}

export class TaskHistoryResponseDto {
  @ApiProperty({ description: 'Task ID' })
  taskId: string;

  @ApiProperty({ description: 'Task type category', enum: ['REVALIDATION', 'CANDIDATE'], example: 'REVALIDATION' })
  taskType: 'REVALIDATION' | 'CANDIDATE';

  @ApiProperty({ description: 'Task summary metadata' })
  task: Record<string, any>;

  @ApiProperty({ type: () => [TaskSurveyorRequestItemDto], description: 'History of requests sent to surveyors and submitted field evidences' })
  surveyorRequests: TaskSurveyorRequestItemDto[];

  @ApiProperty({ type: () => [TaskReviewItemDto], description: 'Reviews and decisions submitted to accomplish this task' })
  reviews: TaskReviewItemDto[];

  @ApiProperty({ type: () => [TaskTimelineEventDto], description: 'Unified chronological event timeline with actor identities' })
  timeline: TaskTimelineEventDto[];
}

export class AdminTaskHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by specific task ID' })
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional({ description: 'Filter by surveyor user ID' })
  @IsOptional()
  @IsString()
  surveyorId?: string;

  @ApiPropertyOptional({ description: 'Filter by reviewer user ID' })
  @IsOptional()
  @IsString()
  reviewerId?: string;

  @ApiPropertyOptional({ description: 'Filter by action type', enum: ['EVIDENCE', 'RECAPTURE', 'REVIEW', 'ALL'] })
  @IsOptional()
  @IsString()
  type?: string;
}
