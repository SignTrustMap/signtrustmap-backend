import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sign_type_images')
export class SignTypeImage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'sign_type_id', type: 'int' })
  signTypeId: number;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  imageUrl: string;

  @Column({ name: 'image_type', type: 'varchar', default: 'REPRESENTATIVE' })
  imageType: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'role', type: 'varchar', length: 50, default: 'MEDOID', nullable: true })
  role: string;

  @Column({ name: 'is_pinned', type: 'boolean', default: false, nullable: true })
  isPinned: boolean;

  @Column({ name: 'sharpness', type: 'float', nullable: true })
  sharpness: number | null;

  @Column({ name: 'uploaded_at', type: 'timestamptz', default: () => 'now()' })
  uploadedAt: Date;
}
