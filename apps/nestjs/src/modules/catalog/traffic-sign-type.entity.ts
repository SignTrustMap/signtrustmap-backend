import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { VehicleType } from '../../common/vehicle-types';
import { SignCategory } from './sign-category.entity';

@Entity('traffic_sign_types')
export class TrafficSignType {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ name: 'category_id', type: 'int' })
  categoryId: number;

  @Column({ name: 'sign_code', type: 'varchar', length: 50, unique: true })
  signCode: string;

  @Column({ name: 'name_vi', type: 'varchar', length: 255 })
  nameVi: string;

  @Column({ name: 'name_en', type: 'varchar', length: 255 })
  nameEn: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'labeling_guidelines', type: 'text', nullable: true })
  labelingGuidelines: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  shape: string | null;

  @Column({ name: 'color_scheme', type: 'varchar', length: 30, nullable: true })
  colorScheme: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    name: 'allowed_vehicles',
    type: 'text',
    array: true,
    default: () =>
      "ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[]",
  })
  allowedVehicles: VehicleType[];

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  @ManyToOne(() => SignCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category: SignCategory;
}
