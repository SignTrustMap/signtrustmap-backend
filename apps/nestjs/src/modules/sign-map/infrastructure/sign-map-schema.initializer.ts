import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { SpatialAdminBackfillService } from '../../spatial-admin/application/spatial-admin-backfill.service';

@Injectable()
export class SignMapSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(SignMapSchemaInitializer.name);

  constructor(
    @Optional()
    private readonly backfillService?: SpatialAdminBackfillService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.backfillService) {
      this.backfillService
        .backfillMissingAddresses(200)
        .catch((err) => this.logger.warn(`Background address backfill warning: ${err?.message}`));
    }
  }
}
