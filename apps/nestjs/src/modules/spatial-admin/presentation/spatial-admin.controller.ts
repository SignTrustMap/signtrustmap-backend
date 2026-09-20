import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SpatialAdminService } from '../application/spatial-admin.service';

@ApiTags('Spatial Admin')
@Public()
@Controller(['spatial', 'addresses'])
export class SpatialAdminController {
  constructor(private readonly spatialService: SpatialAdminService) {}

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
}
