import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sign_type_osm_mappings')
export class SignTypeOsmMapping {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'sign_type_id', type: 'int' })
  signTypeId: number;

  @Column({ name: 'osm_key', type: 'varchar', length: 100 })
  osmKey: string;

  @Column({ name: 'osm_value', type: 'varchar', length: 100 })
  osmValue: string;
}
