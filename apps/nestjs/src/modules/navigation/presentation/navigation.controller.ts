import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RoutePreviewService } from '../application/route-preview.service';
import { RouteDirectionsRequestDto, UpdateNavigationPreferencesDto } from './dto/routing.dto';
import { NavigationResponseDto } from './dto/navigation-response.dto';

@ApiTags('Navigation')
@Controller('navigation')
export class NavigationController {
  constructor(
    private readonly routePreview: RoutePreviewService,
    private readonly dataSource: DataSource,
  ) {}

  @Public()
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

  @ApiBearerAuth()
  @Get('preferences')
  @ApiOperation({
    summary: 'Get navigation preferences',
    description: 'Retrieve current user preference for vehicle type and enabled sign categories',
  })
  async getPreferences(@CurrentUser() user: any) {
    try {
      const rows: any[] = await this.dataSource.query(
        'SELECT default_vehicle_type, enabled_categories FROM driver_profiles WHERE user_id = $1',
        [user.id],
      );
      if (rows.length > 0) {
        return {
          vehicleType: rows[0].default_vehicle_type || 'CAR',
          enabledCategoryCodes: rows[0].enabled_categories || ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'],
        };
      }
    } catch {}
    return {
      vehicleType: 'CAR',
      enabledCategoryCodes: ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'],
    };
  }

  @ApiBearerAuth()
  @Put('preferences')
  @ApiOperation({
    summary: 'Update navigation preferences',
    description: 'Save user preferences for vehicle type and enabled sign categories',
  })
  async updatePreferences(@CurrentUser() user: any, @Body() dto: UpdateNavigationPreferencesDto) {
    const vehicleType = dto.vehicleType || 'CAR';
    const enabledCategories = dto.enabledCategoryCodes || ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'];
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS driver_profiles (
          user_id uuid PRIMARY KEY,
          default_vehicle_type varchar(30) DEFAULT 'CAR',
          enabled_categories text[] DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'],
          total_nav_sessions int NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(
        `INSERT INTO driver_profiles (user_id, default_vehicle_type, enabled_categories, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET default_vehicle_type = $2, enabled_categories = $3, updated_at = now()`,
        [user.id, vehicleType, enabledCategories],
      );
    } catch {}
    return {
      vehicleType,
      enabledCategoryCodes: enabledCategories,
      updated: true,
    };
  }
}
