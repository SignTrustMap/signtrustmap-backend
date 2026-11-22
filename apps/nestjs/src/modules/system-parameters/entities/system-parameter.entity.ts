import { Entity, PrimaryColumn, Column, UpdateDateColumn, CreateDateColumn } from 'typeorm';

export enum ParameterCategory {
  CONSENSUS = 'CONSENSUS',
  REVIEWER = 'REVIEWER',
  REVALIDATION = 'REVALIDATION',
  HAZARDS = 'HAZARDS',
  NAVIGATION = 'NAVIGATION',
  ECONOMY = 'ECONOMY',
  INGESTION = 'INGESTION',
  AIOPS = 'AIOPS',
  SECURITY = 'SECURITY',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
}

export enum ParameterDataType {
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  JSON = 'JSON',
  PERCENTAGE = 'PERCENTAGE',
  DURATION = 'DURATION',
}

@Entity('system_parameters')
export class SystemParameter {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: ParameterCategory,
    default: ParameterCategory.INFRASTRUCTURE,
  })
  category: ParameterCategory;

  @Column({ type: 'varchar', length: 50, nullable: true })
  domain?: string | null;

  @Column({ name: 'domain_label', type: 'varchar', length: 100, nullable: true })
  domainLabel?: string | null;

  @Column({
    name: 'data_type',
    type: 'enum',
    enum: ParameterDataType,
    default: ParameterDataType.STRING,
  })
  dataType: ParameterDataType;

  @Column({ type: 'varchar', length: 150, nullable: true })
  range?: string | null;

  @Column({ name: 'validation_rules', type: 'jsonb', default: () => "'{}'" })
  validationRules: Record<string, any>;

  @Column({ name: 'requires_restart', type: 'boolean', default: false })
  requiresRestart: boolean;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
