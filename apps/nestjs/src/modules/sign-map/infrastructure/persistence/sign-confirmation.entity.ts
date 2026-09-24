import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sign_confirmations')
export class SignConfirmationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sign_id', type: 'uuid' })
  signId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'is_present', type: 'boolean' })
  isPresent: boolean;

  @Column({ name: 'credits_awarded', type: 'int', default: 0 })
  creditsAwarded: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
