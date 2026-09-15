import { Module } from '@nestjs/common';
import { CatalogSyncService } from './catalog-sync.service';

@Module({
  providers: [CatalogSyncService],
  exports: [CatalogSyncService],
})
export class CatalogSyncModule {}