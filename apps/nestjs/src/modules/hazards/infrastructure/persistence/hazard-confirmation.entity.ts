import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { RoadHazardEvent } from './road-hazard-event.entity';

export enum HazardVoteType {
  CONFIRM = 'CONFIRM',
  DISMISS = 'DISMISS',
}

@Entity('hazard_confirmations')
@Unique(['hazardId', 'userId'])
export class HazardConfirmation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hazard_id', type: 'uuid' })
  hazardId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'vote_type',
    type: 'varchar',
    length: 16,
  })
  voteType: HazardVoteType;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  location?: any;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => RoadHazardEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hazard_id' })
  hazard: RoadHazardEvent;
}
