import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('mission_contribution_events')
@Unique('uq_mission_contribution_user_event_source', ['userId', 'eventType', 'sourceId'])
@Index('idx_mission_contribution_user_occurred', ['userId', 'occurredAt'])
export class MissionContributionEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;
}
