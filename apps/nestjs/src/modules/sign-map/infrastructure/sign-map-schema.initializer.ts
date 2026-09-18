import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SignMapSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(SignMapSchemaInitializer.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        ALTER TABLE "traffic_sign_types"
          ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
            NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];
        CREATE TABLE IF NOT EXISTS "driver_profiles" (
          user_id uuid PRIMARY KEY,
          default_vehicle_type varchar(30) DEFAULT 'CAR',
          enabled_categories text[] DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'],
          total_nav_sessions int NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE "driver_profiles"
          ADD COLUMN IF NOT EXISTS "enabled_categories" text[]
            DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'];
      `);
      this.logger.log('SignMap schema preflight verified (allowed_vehicles, driver_profiles).');
    } catch (error: any) {
      this.logger.warn(`SignMap schema preflight check warning: ${error?.message || error}`);
    }
  }
}
