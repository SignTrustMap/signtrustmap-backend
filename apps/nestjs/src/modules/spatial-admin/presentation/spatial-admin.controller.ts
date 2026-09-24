import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SpatialAdminService } from '../application/spatial-admin.service';
import { SpatialAdminBackfillService } from '../application/spatial-admin-backfill.service';

@ApiTags('Spatial Admin')
@Public()
@Controller(['spatial', 'addresses'])
export class SpatialAdminController {
  constructor(
    private readonly spatialService: SpatialAdminService,
    private readonly backfillService: SpatialAdminBackfillService,
  ) {}

  @ApiOperation({
    summary: 'Resolve GPS point to 2-tier administrative address and road name',
    description:
      'Performs Point-in-Polygon against current Vietnamese 2-tier administrative boundary (QD 19/2025/QD-TTg) and snaps nearest OSM road segment.',
  })
  @ApiQuery({ name: 'lat', type: Number, required: true, example: 10.8505 })
  @ApiQuery({ name: 'lon', type: Number, required: true, example: 106.7719 })
  @Get('resolve')
  async resolve(@Query('lat') lat: string, @Query('lon') lon: string) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Valid lat and lon numeric query parameters are required');
    }
    return this.spatialService.resolveLocation(latitude, longitude);
  }

  @ApiOperation({
    summary: 'Search administrative units (supports legacy district names)',
    description:
      'Search for communes/wards by modern name or legacy district name (e.g. "Quận 1", "TP. Thủ Đức", "Bến Nghé").',
  })
  @ApiQuery({ name: 'q', type: String, required: true, example: 'Quận 1' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @Get('search')
  async search(@Query('q') query: string, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number(limit) : 10;
    return this.spatialService.search(query, Number.isFinite(parsedLimit) ? parsedLimit : 10);
  }

  @ApiOperation({
    summary: 'Trigger spatial address backfill',
    description:
      'Runs batch backfill on verified signs missing display address or commune code using internal PostGIS.',
  })
  @ApiQuery({ name: 'batchSize', type: Number, required: false, example: 50 })
  @ApiQuery({ name: 'maxTotal', type: Number, required: false, example: 5000 })
  @Post('backfill')
  async backfill(@Query('batchSize') batchSize?: string, @Query('maxTotal') maxTotal?: string) {
    const parsedBatch = batchSize ? Number(batchSize) : 50;
    const parsedTotal = maxTotal ? Number(maxTotal) : 5000;
    return this.backfillService.runBackfill(
      Number.isFinite(parsedBatch) ? parsedBatch : 50,
      Number.isFinite(parsedTotal) ? parsedTotal : 5000,
    );
  }
}
