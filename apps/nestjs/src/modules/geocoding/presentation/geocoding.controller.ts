import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { GeocodingSearchQueryDto } from './dto/geocoding.dto';
import { GeocodingService } from '../application/geocoding.service';

@ApiTags('Geocoding')
@Public()
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @ApiOperation({ summary: 'Search places and addresses', description: 'Geocode search queries with viewport bounding-box and country filtering via OpenStreetMap Nominatim' })
  @Get('search')
  search(@Query() query: GeocodingSearchQueryDto) {
    return this.geocoding.search({
      query: query.q,
      limit: query.limit,
      countryCode: query.countryCode,
      minLatitude: query.minLat,
      minLongitude: query.minLon,
      maxLatitude: query.maxLat,
      maxLongitude: query.maxLon,
    });
  }
}
