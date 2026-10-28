import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { TransactionType } from '../../../wallet/infrastructure/persistence/credit-transaction.entity';

@Entity('credit_rules')
export class CreditRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'transaction_type', type: 'varchar' })
  transactionType: TransactionType;

  @Column({ name: 'reward_amount', type: 'int' })
  rewardAmount: number;

  @Column({ name: 'condition_desc', type: 'text', nullable: true })
  conditionDesc: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom: Date;
}
