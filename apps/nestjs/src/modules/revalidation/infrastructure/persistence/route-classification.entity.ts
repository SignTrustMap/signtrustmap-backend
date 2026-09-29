import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('route_classifications')
export class RouteClassification {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  name: string;

  @Column({ name: 'road_type', type: 'varchar', length: 32 })
  roadType: string;

  @Column({ name: 'default_lifetime_days', type: 'int' })
  defaultLifetimeDays: number;

  @Column({ name: 'revalidation_threshold_days', type: 'int' })
  revalidationThresholdDays: number;

  @Column({ name: 'spatial_buffer_meters', type: 'int', default: 20 })
  spatialBufferMeters: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
