import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  SURVEY_REWARD = 'SURVEY_REWARD',
  REVIEW_REWARD = 'REVIEW_REWARD',
  REVALIDATION_REWARD = 'REVALIDATION_REWARD',
  SIGN_DECOMMISSION_REWARD = 'SIGN_DECOMMISSION_REWARD',
  HAZARD_REPORT_REWARD = 'HAZARD_REPORT_REWARD',
  HAZARD_CONFIRM_REWARD = 'HAZARD_CONFIRM_REWARD',
  DAILY_TASK_REWARD = 'DAILY_TASK_REWARD',
  NAVIGATION_FEE = 'NAVIGATION_FEE',
  CUSTOM_PROFILE_SPEND = 'CUSTOM_PROFILE_SPEND',
  TOP_UP = 'TOP_UP',
  REFUND = 'REFUND',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  REWARD_WITHHELD = 'REWARD_WITHHELD',
}

@Entity('credit_transactions')
@Index('idx_credit_transactions_wallet_created', ['walletId', 'createdAt'])
export class CreditTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'balance_after', type: 'bigint', nullable: true })
  balanceAfter: string | null;

  @Column({ name: 'transaction_type', type: 'enum', enum: TransactionType })
  transactionType: TransactionType;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true, unique: true })
  idempotencyKey: string | null;

  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'::jsonb" })
  metadata: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;
}
