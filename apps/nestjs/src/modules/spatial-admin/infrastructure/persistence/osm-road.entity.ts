import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('osm_roads')
export class OsmRoad {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'osm_id', type: 'bigint', nullable: true })
  osmId?: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ref?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'residential' })
  highway: string;

  @Index('idx_osm_roads_geom', { spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'LineString', srid: 4326 })
  geometry: string;
}
