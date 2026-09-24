import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('camera_calibration_profiles')
export class CameraCalibrationProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_camera_calibration_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_model', type: 'varchar', length: 100 })
  deviceModel: string;

  @Column({
    name: 'camera_height_meters',
    type: 'float',
    default: 1.35,
  })
  cameraHeightMeters: number;

  @Column({
    name: 'pitch_angle_degrees',
    type: 'float',
    default: 0.0,
  })
  pitchAngleDegrees: number;

  @Column({
    name: 'yaw_offset_degrees',
    type: 'float',
    default: 0.0,
  })
  yawOffsetDegrees: number;

  @Column({
    name: 'hfov_degrees',
    type: 'float',
    default: 60.0,
  })
  hfovDegrees: number;

  @Column({
    name: 'focal_length_px',
    type: 'float',
    nullable: true,
  })
  focalLengthPx: number | null;

  @Column({ name: 'is_default', type: 'boolean', default: true })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
