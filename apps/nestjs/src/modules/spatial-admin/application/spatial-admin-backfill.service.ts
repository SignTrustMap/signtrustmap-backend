import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpatialAdminService } from './spatial-admin.service';

@Injectable()
export class SpatialAdminBackfillService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SpatialAdminBackfillService.name);
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly spatialAdminService: SpatialAdminService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Initial run 3 seconds after boot
    setTimeout(() => {
      this.runBackfillSafe();
    }, 3_000);

    // Periodic sweep every 30 seconds to catch newly inserted or reset signs
    this.intervalTimer = setInterval(() => {
      this.runBackfillSafe();
    }, 30_000);
  }

  onApplicationShutdown(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private runBackfillSafe(): void {
    if (this.isRunning) return;
    this.runBackfill().catch((err) => {
      this.logger.error(`SpatialAdminBackfill failed: ${err?.message}`, err?.stack);
    });
  }

  async runBackfill(batchSize = 50, maxTotal = 5000): Promise<{ processed: number; success: number }> {
    if (this.isRunning) {
      this.logger.log('SpatialAdminBackfill already in progress, skipping concurrent run.');
      return { processed: 0, success: 0 };
    }

    this.isRunning = true;
    let totalProcessed = 0;
    let totalSuccess = 0;

    try {
      this.logger.log('Starting spatial address backfill via PostGIS...');

      while (totalProcessed < maxTotal) {
        const rows: Array<{ id: string; longitude: number; latitude: number }> =
          await this.dataSource.query(
            `SELECT
               id,
               ST_X(location::geometry) AS longitude,
               ST_Y(location::geometry) AS latitude
             FROM verified_traffic_signs
             WHERE location IS NOT NULL
               AND (
                 commune_code IS NULL
                 OR display_address IS NULL
               )
             ORDER BY created_at DESC
             LIMIT $1`,
            [batchSize],
          );

        if (!rows || rows.length === 0) {
          this.logger.log('No remaining verified signs requiring address backfill.');
          break;
        }

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
                   road_name = $2,
                   display_address = $3,
                   updated_at = NOW()
                 WHERE id = $4`,
                [resolved.communeCode, resolved.roadName, resolved.displayAddress, row.id],
              );
              totalSuccess++;
            }
          } catch (err: any) {
            this.logger.warn(`Failed to backfill sign ${row.id}: ${err?.message}`);
          }
          totalProcessed++;

          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        if (rows.length < batchSize) break;
      }

      if (totalProcessed > 0) {
        this.logger.log(
          `SpatialAdminBackfill completed. Processed: ${totalProcessed}, Successfully updated: ${totalSuccess}.`,
        );
      }
    } catch (err: any) {
      this.logger.error(`SpatialAdminBackfill error: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }

    return { processed: totalProcessed, success: totalSuccess };
  }

  async backfillMissingAddresses(batchSize = 200): Promise<{ processed: number; success: number }> {
    return this.runBackfill(batchSize);
  }
}
