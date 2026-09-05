import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('topup_packages')
export class TopupPackage {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ name: 'package_name', type: 'varchar', length: 100 })
  packageName: string;

  @Column({ name: 'price_vnd', type: 'decimal', precision: 12, scale: 2 })
  priceVnd: string;

  @Column({ name: 'credit_amount', type: 'int' })
  creditAmount: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
