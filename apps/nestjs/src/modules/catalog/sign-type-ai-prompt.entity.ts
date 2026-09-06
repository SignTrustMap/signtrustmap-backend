import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sign_type_ai_prompts')
export class SignTypeAiPrompt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'sign_type_id', type: 'int' })
  signTypeId: number;

  @Column({ name: 'prompt_text', type: 'text' })
  promptText: string;

  @Column({ name: 'target_model', type: 'varchar', default: 'CLIP' })
  targetModel: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
