import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 30, unique: true })
  code: string;

  @Column({ name: 'name_vi', type: 'varchar', length: 100 })
  nameVi: string;

  @Column({ name: 'name_en', type: 'varchar', length: 100 })
  nameEn: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
