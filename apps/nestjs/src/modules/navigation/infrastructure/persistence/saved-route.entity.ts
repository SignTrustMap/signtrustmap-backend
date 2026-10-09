import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('saved_routes')
export class SavedRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ name: 'vehicle_mode', type: 'varchar', length: 20, default: 'MOTORCYCLE' })
  vehicleMode: string;

  @Column({ name: 'origin_name', type: 'varchar', length: 255 })
  originName: string;

  @Column({ name: 'origin_latitude', type: 'double precision' })
  originLatitude: number;

  @Column({ name: 'origin_longitude', type: 'double precision' })
  originLongitude: number;

  @Column({ name: 'destination_name', type: 'varchar', length: 255 })
  destinationName: string;

  @Column({ name: 'destination_latitude', type: 'double precision' })
  destinationLatitude: number;

  @Column({ name: 'destination_longitude', type: 'double precision' })
  destinationLongitude: number;

  @Column({ name: 'waypoints', type: 'jsonb', default: () => "'[]'::jsonb" })
  waypoints: Array<{ latitude: number; longitude: number; name?: string }>;

  @Column({ name: 'distance_meters', type: 'int', default: 0 })
  distanceMeters: number;

  @Column({ name: 'duration_seconds', type: 'int', default: 0 })
  durationSeconds: number;

  @Column({ name: 'encoded_polyline', type: 'text', default: '' })
  encodedPolyline: string;

  @Column({
    name: 'filter_rules',
    type: 'jsonb',
    default: () => "'{\"onlyFixedSigns\": true, \"categories\": [\"P\",\"W\",\"R\",\"I\"]}'::jsonb",
  })
  filterRules: {
    onlyFixedSigns?: boolean;
    categories?: string[];
    [key: string]: any;
  };

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
