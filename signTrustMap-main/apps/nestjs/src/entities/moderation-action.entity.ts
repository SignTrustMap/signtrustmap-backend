import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ModerationCase } from './moderation-case.entity';

@Entity('moderation_actions')
export class ModerationAction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'action_type', type: 'varchar', length: 50 })
  actionType: string;

  @Column({ name: 'performed_by', type: 'uuid' })
  performedBy: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'performed_at', type: 'timestamptz' })
  performedAt: Date;

  @ManyToOne(() => ModerationCase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  moderationCase: ModerationCase;
}
