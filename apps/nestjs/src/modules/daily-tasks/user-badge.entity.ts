import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('user_badges')
export class UserBadge {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'badge_code', type: 'varchar', length: 64 })
  badgeCode: string;

  @CreateDateColumn({ name: 'earned_at', type: 'timestamptz' })
  earnedAt: Date;
}
