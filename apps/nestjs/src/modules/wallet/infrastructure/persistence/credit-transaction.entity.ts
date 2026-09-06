import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  SURVEY_REWARD = 'SURVEY_REWARD',
  REVIEW_REWARD = 'REVIEW_REWARD',
  REVALIDATION_REWARD = 'REVALIDATION_REWARD',
  DAILY_TASK_REWARD = 'DAILY_TASK_REWARD',
  NAVIGATION_FEE = 'NAVIGATION_FEE',
  TOP_UP = 'TOP_UP',
  REFUND = 'REFUND',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
}

@Entity('credit_transactions')
export class CreditTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'transaction_type', type: 'enum', enum: TransactionType })
  transactionType: TransactionType;

  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;
}
