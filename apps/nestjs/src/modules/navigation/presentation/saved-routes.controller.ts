import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SavedRoutesService } from '../application/saved-routes.service';
import {
  CreateSavedRouteDto,
  UpdateSavedRouteDto,
} from './dto/saved-route.dto';

@ApiTags('Saved Routes')
@ApiBearerAuth()
@Controller('saved-routes')
export class SavedRoutesController {
  constructor(private readonly service: SavedRoutesService) {}

  @ApiOperation({
    summary: 'List user saved routes',
    description: 'Retrieve bookmarked routes (wishlist) for the authenticated user, optionally filtered by vehicle mode',
  })
  @Get()
  list(
    @CurrentUser() user: any,
    @Query('vehicleMode') vehicleMode?: string,
  ) {
    return this.service.listForUser(user.id, vehicleMode);
  }

  @ApiOperation({
    summary: 'Get saved route details',
    description: 'Retrieve a single saved route by its ID',
  })
  @Get(':id')
  getOne(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getById(user.id, id);
  }

  @ApiOperation({
    summary: 'Bookmark a new route',
    description: 'Save a travel route with origin, destination, vehicle preference, polyline and sign filter preferences',
  })
  @Post()
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateSavedRouteDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @ApiOperation({
    summary: 'Update saved route',
    description: 'Modify title, preferred vehicle mode, or sign filter rules for an existing saved route',
  })
  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedRouteDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @ApiOperation({
    summary: 'Delete saved route',
    description: 'Remove a bookmarked route from the wishlist',
  })
  @Delete(':id')
  remove(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.delete(user.id, id);
  }

  @ApiOperation({
    summary: 'Get fixed signs along saved route',
    description: 'Query all fixed traffic signs located along this bookmarked route corridor matching its vehicle and filter rules',
  })
  @Get(':id/signs')
  getSignPreview(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getSignsForSavedRoute(user.id, id);
  }
}
