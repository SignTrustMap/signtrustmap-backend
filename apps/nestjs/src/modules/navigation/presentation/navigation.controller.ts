import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { RoutePreviewService } from '../application/route-preview.service';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { NavigationResponseDto } from './dto/navigation-response.dto';

@ApiTags('navigation')
@Public()
@Controller('navigation')
export class NavigationController {
  constructor(private readonly routePreview: RoutePreviewService) {}

  @Post('route-preview')
  @ApiOperation({ summary: 'Get navigation directions and verified signs along the route' })
  @ApiOkResponse({ type: NavigationResponseDto })
  previewRoute(@Body() request: RouteDirectionsRequestDto) {
    return this.routePreview.previewRoute(request);
  }
}
