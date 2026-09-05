import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

@Entity('payment_orders')
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'package_id', type: 'int' })
  packageId: number;

  @Column({ name: 'order_code', type: 'varchar', length: 100, unique: true })
  orderCode: string;

  @Column({ name: 'amount_vnd', type: 'decimal', precision: 12, scale: 2 })
  amountVnd: string;

  @Column({ type: 'varchar', length: 50 })
  gateway: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
