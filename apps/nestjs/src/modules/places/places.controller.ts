import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlacesService } from './places.service';

@ApiTags('Places')
@ApiBearerAuth()
@Controller()
export class PlacesController {
  constructor(private svc: PlacesService) {}

  // ── Saved Places (Home / Work / Saved) ──
  @ApiOperation({ summary: 'List saved places', description: 'Retrieve saved driver places including Home, Work, and custom favorites' })
  @Get('places/saved')
  listSaved(@CurrentUser() user: any) {
    return this.svc.listSavedPlaces(user.id);
  }

  @ApiOperation({ summary: 'Add saved place', description: 'Save a location with label, coordinates, and address' })
  @Post('places/saved')
  addSaved(@CurrentUser() user: any, @Body() dto: { label: string; address: string; latitude: number; longitude: number; placeType?: string }) {
    return this.svc.addSavedPlace(user.id, dto);
  }

  @ApiOperation({ summary: 'Remove saved place', description: 'Delete a saved place by ID' })
  @Delete('places/saved/:id')
  removeSaved(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeSavedPlace(user.id, id);
  }

  // ── Recent Searches ──
  @ApiOperation({ summary: 'List recent searches', description: 'Retrieve recent destination search history for the user' })
  @Get('places/recent-searches')
  listRecent(@CurrentUser() user: any, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.svc.listRecentSearches(user.id, Number.isNaN(n) ? 20 : n);
  }

  @ApiOperation({ summary: 'Add recent search', description: 'Record a destination query or place in recent history' })
  @Post('places/recent-searches')
  addRecent(@CurrentUser() user: any, @Body() dto: { query: string; address?: string; latitude?: number; longitude?: number }) {
    return this.svc.addRecentSearch(user.id, dto);
  }

  @ApiOperation({ summary: 'Clear all recent searches', description: 'Delete all recent search entries for current user' })
  @Delete('places/recent-searches')
  clearRecent(@CurrentUser() user: any) {
    return this.svc.clearRecentSearches(user.id);
  }

  @ApiOperation({ summary: 'Delete single recent search', description: 'Delete a specific search history entry by ID' })
  @Delete('places/recent-searches/:id')
  deleteRecent(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRecentSearch(user.id, id);
  }
}
