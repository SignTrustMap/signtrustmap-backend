import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('admin_provinces')
export class AdminProvince {
  @PrimaryColumn({ type: 'varchar', length: 2 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'PROVINCE' })
  type: string;

  @Index('idx_admin_provinces_geom', { spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'MultiPolygon', srid: 4326, nullable: true })
  geometry?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
