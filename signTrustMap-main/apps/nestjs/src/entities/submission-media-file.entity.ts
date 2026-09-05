import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { SurveySubmission } from './survey-submission.entity';

export enum MediaFileType {
  VIDEO = 'VIDEO',
  GPX = 'GPX',
  IMAGE = 'IMAGE',
}

@Entity('submission_media_files')
export class SubmissionMediaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @Column({ name: 'media_type', type: 'enum', enum: MediaFileType })
  mediaType: MediaFileType;

  @Column({ name: 'file_url', type: 'varchar', length: 500 })
  fileUrl: string;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: string | null;

  @Column({ name: 'duration_seconds', type: 'float', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;

  @ManyToOne(() => SurveySubmission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission: SurveySubmission;
}
