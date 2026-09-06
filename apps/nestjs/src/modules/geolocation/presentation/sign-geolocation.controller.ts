import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SignGeolocationService } from '../application/sign-geolocation.service';
import {
  SignGeolocationRequestDto,
  SignGeolocationResponseDto,
} from './dto/sign-geolocation.dto';

@ApiTags('geolocation')
@Public()
@Controller('geolocation')
export class SignGeolocationController {
  constructor(private readonly service: SignGeolocationService) {}

  @Post('signs')
  @ApiOperation({
    summary: 'Estimate a traffic sign location from camera observations',
    description: 'Calculates a candidate location without persisting a verified sign',
  })
  @ApiOkResponse({ type: SignGeolocationResponseDto })
  geolocate(@Body() request: SignGeolocationRequestDto): SignGeolocationResponseDto {
    return this.service.geolocate(request);
  }
}
