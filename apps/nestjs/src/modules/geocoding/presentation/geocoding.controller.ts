import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { GeocodingSearchQueryDto } from './dto/geocoding.dto';
import { GeocodingService } from '../application/geocoding.service';

@Public()
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

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
