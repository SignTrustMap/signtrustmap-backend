import { Controller, Get, Post, Delete, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlacesService } from './places.service';

@Controller()
export class PlacesController {
  constructor(private svc: PlacesService) {}

  // ── Saved Places (Home / Work / Saved) ──
  @Get('places/saved')
  listSaved(@CurrentUser() user: any) {
    return this.svc.listSavedPlaces(user.id);
  }

  @Post('places/saved')
  addSaved(@CurrentUser() user: any, @Body() dto: { label: string; address: string; latitude: number; longitude: number; placeType?: string }) {
    return this.svc.addSavedPlace(user.id, dto);
  }

  @Delete('places/saved/:id')
  removeSaved(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeSavedPlace(user.id, id);
  }

  // ── Recent Searches ──
  @Get('places/recent-searches')
  listRecent(@CurrentUser() user: any, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.svc.listRecentSearches(user.id, Number.isNaN(n) ? 20 : n);
  }

  @Post('places/recent-searches')
  addRecent(@CurrentUser() user: any, @Body() dto: { query: string; address?: string; latitude?: number; longitude?: number }) {
    return this.svc.addRecentSearch(user.id, dto);
  }

  @Delete('places/recent-searches')
  clearRecent(@CurrentUser() user: any) {
    return this.svc.clearRecentSearches(user.id);
  }

  @Delete('places/recent-searches/:id')
  deleteRecent(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRecentSearch(user.id, id);
  }
}
