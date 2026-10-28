import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('admin_communes')
export class AdminCommune {
  @PrimaryColumn({ type: 'varchar', length: 5 })
  code: string;

  @Column({ name: 'province_code', type: 'varchar', length: 2 })
  provinceCode: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'WARD' })
  type: string;

  @Index('idx_admin_communes_geom', { spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'MultiPolygon', srid: 4326 })
  geometry: string;

  @Column({ name: 'legacy_district_name', type: 'varchar', length: 100, nullable: true })
  legacyDistrictName?: string | null;

  @Column({ name: 'legacy_ward_name', type: 'varchar', length: 100, nullable: true })
  legacyWardName?: string | null;

  @Column({ name: 'search_tsv', type: 'tsvector', select: false, nullable: true })
  searchTsv?: string | null;

  @Column({ name: 'valid_from', type: 'date', nullable: true, default: '2025-07-01' })
  validFrom?: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo?: string | null;

  @Column({ name: 'boundary_version', type: 'varchar', length: 20, default: '2025-07-01' })
  boundaryVersion: string;
}
