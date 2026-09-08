import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaFileType } from './submission-media-file.entity';

export enum UploadStatus {
  INITIATED = 'INITIATED',
  UPLOADING = 'UPLOADING',
  ASSEMBLING = 'ASSEMBLING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

@Entity('upload_sessions')
export class UploadSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 500 })
  originalFilename: string;

  @Column({ name: 'media_type', type: 'enum', enum: MediaFileType })
  mediaType: MediaFileType;

  @Column({ name: 'total_size_bytes', type: 'bigint' })
  totalSizeBytes: string;

  @Column({ name: 'total_chunks', type: 'int' })
  totalChunks: number;

  @Column({ name: 'received_chunks', type: 'int', default: 0 })
  receivedChunks: number;

  @Column({ name: 'checksum_expected', type: 'varchar', length: 128, nullable: true })
  checksumExpected: string | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 500, nullable: true })
  storageKey: string | null;

  @Column({ type: 'enum', enum: UploadStatus, default: UploadStatus.INITIATED })
  status: UploadStatus;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
