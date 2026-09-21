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
   * Backfills verified traffic signs that are missing commune_code, road_name, or have partial display_address.
   * Processes in batches until all signs in the database have full 2-tier addresses.
   */
  async backfillMissingAddresses(batchSize = 50, maxTotal = 3000): Promise<{ processed: number; success: number }> {
    if (this.isRunning) {
      this.logger.log('Spatial admin address backfill already in progress, skipping duplicate run.');
      return { processed: 0, success: 0 };
    }

    this.isRunning = true;
    let totalProcessed = 0;
    let totalSuccess = 0;

    try {
      this.logger.log('Starting full 2-tier spatial address backfill via Photon...');

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
                  OR road_name IS NULL
                  OR display_address IS NULL
                  OR display_address = 'Thành phố Hồ Chí Minh'
                  OR display_address = 'Thành phố Hà Nội'
                  OR display_address ILIKE '%Phường Saigon%'
                  OR road_name ILIKE '%Street%'
                  OR road_name ILIKE '%Road%'
                  OR road_name ILIKE '%Boulevard%'
                  OR road_name ILIKE 'Hướng đi %'
                  OR (
                    road_name IS NOT NULL
                    AND road_name NOT ILIKE 'Đường %'
                    AND road_name NOT ILIKE 'Cầu %'
                    AND road_name NOT ILIKE 'Hầm %'
                    AND road_name NOT ILIKE 'Đại lộ %'
                    AND road_name NOT ILIKE 'Xa lộ %'
                    AND road_name NOT ILIKE 'Quốc lộ %'
                    AND road_name NOT ILIKE 'QL%'
                    AND road_name NOT ILIKE 'Tỉnh lộ %'
                    AND road_name NOT ILIKE 'TL%'
                    AND road_name NOT ILIKE 'Hẻm %'
                    AND road_name NOT ILIKE 'Ngõ %'
                    AND road_name NOT ILIKE 'Giao lộ %'
                    AND road_name NOT ILIKE 'Nút giao %'
                    AND road_name NOT ILIKE 'Bến %'
                  )
                  OR (
                    road_name ~* '\b(Nguyen|Tran|Le|Pham|Hoang|Phan|Vu|Vo|Dang|Bui|Do|Ho|Ngo|Duong|Ly|Huynh)\b'
                    AND road_name !~* '[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]'
                  )
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

          // Gentle throttle between requests
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        this.logger.log(`Backfilled ${totalSuccess}/${totalProcessed} signs so far...`);
      }

      this.logger.log(`Completed full address backfill: ${totalSuccess}/${totalProcessed} signs updated.`);
      return { processed: totalProcessed, success: totalSuccess };
    } finally {
      this.isRunning = false;
    }
  }
}
