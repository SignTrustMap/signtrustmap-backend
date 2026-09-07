import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { RoutePreviewService } from '../application/route-preview.service';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { NavigationResponseDto } from './dto/navigation-response.dto';

@ApiTags('Navigation')
@Public()
@Controller('navigation')
export class NavigationController {
  constructor(private readonly routePreview: RoutePreviewService) {}

  @Post('route-preview')
  @ApiOperation({
    summary: 'Preview navigation route and signs',
    description:
      'Calculate route geometry and retrieve verified traffic signs along the path in one request.',
  })
  @ApiOkResponse({ type: NavigationResponseDto })
  previewRoute(@Body() request: RouteDirectionsRequestDto) {
    return this.routePreview.previewRoute(request);
  }
}
