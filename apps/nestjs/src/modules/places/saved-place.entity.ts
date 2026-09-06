import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('saved_places')
export class SavedPlace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 100 })
  label: string; // Home, Work, Custom name

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ name: 'place_type', type: 'varchar', length: 20, default: 'CUSTOM' })
  placeType: string; // HOME, WORK, SAVED

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
