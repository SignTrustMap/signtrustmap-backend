import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('payment_methods')
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'card_holder_name', type: 'varchar', length: 100 })
  cardHolderName: string;

  @Column({ name: 'card_last4', type: 'varchar', length: 4 })
  cardLast4: string;

  @Column({ name: 'card_brand', type: 'varchar', length: 20, default: 'VISA' })
  cardBrand: string;

  @Column({ name: 'expiry_month', type: 'varchar', length: 2 })
  expiryMonth: string;

  @Column({ name: 'expiry_year', type: 'varchar', length: 4 })
  expiryYear: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
