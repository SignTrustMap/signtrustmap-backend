import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('driver_profiles')
export class DriverProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'default_vehicle_type', type: 'varchar', length: 30, nullable: true, default: 'CAR' })
  defaultVehicleType: string;

  @Column({ name: 'home_location', type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  homeLocation?: string | null;

  @Column({ name: 'total_nav_sessions', type: 'int', default: 0 })
  totalNavSessions: number;

  @Column({ name: 'enabled_categories', type: 'text', array: true, nullable: true })
  enabledCategories?: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
