import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { RoadHazardEvent } from './road-hazard-event.entity';

export enum HazardEvidenceType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

@Entity('hazard_evidence')
@Index('uq_hazard_evidence_storage_key', ['hazardId', 'storageKey'], { unique: true })
export class HazardEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hazard_id', type: 'uuid' })
  hazardId: string;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @Column({ name: 'media_type', type: 'varchar', length: 16 })
  mediaType: HazardEvidenceType;

  @Column({ name: 'file_url', type: 'varchar', length: 500 })
  fileUrl: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  @Column({ name: 'file_size_bytes', type: 'bigint' })
  fileSizeBytes: string;

  @Column({ name: 'content_type', type: 'varchar', length: 128, nullable: true })
  contentType: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;

  @ManyToOne(() => RoadHazardEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hazard_id' })
  hazard: RoadHazardEvent;
}
