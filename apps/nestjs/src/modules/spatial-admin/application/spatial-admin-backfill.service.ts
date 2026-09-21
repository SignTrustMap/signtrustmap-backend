import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpatialAdminService } from './spatial-admin.service';

@Injectable()
export class SpatialAdminBackfillService {
  private readonly logger = new Logger(SpatialAdminBackfillService.name);
  private isRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly spatialAdminService: SpatialAdminService,
  ) {}

  /**
   * Backfills verified traffic signs that are missing commune_code, road_name, or display_address.
   * Runs in batches with throttled reverse geocoding slots to respect rate limits.
   */
  async backfillMissingAddresses(limit = 100): Promise<{ processed: number; success: number }> {
    if (this.isRunning) {
      this.logger.log('Spatial admin address backfill already in progress, skipping duplicate run.');
      return { processed: 0, success: 0 };
    }

    this.isRunning = true;
    try {
      const rows: Array<{ id: string; longitude: number; latitude: number }> =
        await this.dataSource.query(
          `SELECT
             id,
             ST_X(location::geometry) AS longitude,
             ST_Y(location::geometry) AS latitude
           FROM verified_traffic_signs
           WHERE location IS NOT NULL
             AND (commune_code IS NULL OR road_name IS NULL OR display_address IS NULL)
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit],
        );

      if (!rows.length) {
        return { processed: 0, success: 0 };
      }

      this.logger.log(`Starting real address resolution backfill for ${rows.length} verified signs...`);
      let success = 0;

      for (const row of rows) {
        try {
          const resolved = await this.spatialAdminService.resolveLocation(
            Number(row.latitude),
            Number(row.longitude),
          );

          if (resolved.displayAddress) {
            await this.dataSource.query(
              `UPDATE verified_traffic_signs
               SET
                 commune_code = COALESCE($1, commune_code),
                 road_name = COALESCE($2, road_name),
                 display_address = $3,
                 updated_at = NOW()
               WHERE id = $4`,
              [resolved.communeCode, resolved.roadName, resolved.displayAddress, row.id],
            );
            success++;
          }
        } catch (err: any) {
          this.logger.warn(`Failed to backfill sign ${row.id}: ${err?.message}`);
        }
      }

      this.logger.log(`Completed address backfill: ${success}/${rows.length} signs updated.`);
      return { processed: rows.length, success };
    } finally {
      this.isRunning = false;
    }
  }
}
