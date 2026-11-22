import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SystemParameter } from './system-parameter.entity';
import { User } from '../../auth/infrastructure/persistence/user.entity';

@Entity('parameter_audit_logs')
export class ParameterAuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'parameter_key', type: 'varchar', length: 100 })
  parameterKey: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue: string | null;

  @Column({ name: 'new_value', type: 'text' })
  newValue: string;

  @Column({ name: 'change_reason', type: 'text' })
  changeReason: string;

  @Column({ name: 'changed_by', type: 'uuid' })
  changedBy: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => SystemParameter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parameter_key' })
  parameter?: SystemParameter;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'changed_by' })
  user?: User;
}
