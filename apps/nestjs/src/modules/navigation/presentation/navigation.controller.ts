import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource, Repository } from 'typeorm';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoutePreviewService } from '../application/route-preview.service';
import { NavigationCreditGateService } from '../application/navigation-credit-gate.service';
import { RouteDirectionsRequestDto, UpdateNavigationPreferencesDto } from './dto/routing.dto';
import { NavigationResponseDto } from './dto/navigation-response.dto';
import { InitiateNavigationSessionDto } from './dto/initiate-navigation-session.dto';
import { CreateAlertProfileDto } from './dto/create-alert-profile.dto';
import { DriverProfile } from '../../auth/infrastructure/persistence/driver-profile.entity';

@ApiTags('Navigation')
@Controller('navigation')
export class NavigationController {
  private readonly logger = new Logger(NavigationController.name);

  constructor(
    private readonly routePreview: RoutePreviewService,
    private readonly dataSource: DataSource,
    private readonly creditGate: NavigationCreditGateService,
    @Optional()
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo?: Repository<DriverProfile>,
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
    const userId = user?.id ?? user?.sub;
    try {
      if (this.driverProfileRepo && typeof this.driverProfileRepo.findOne === 'function') {
        const profile = await this.driverProfileRepo.findOne({
          where: { userId },
          select: ['defaultVehicleType', 'enabledCategories'],
        });
        if (profile) {
          return {
            vehicleType: profile.defaultVehicleType || 'CAR',
            enabledCategoryCodes: profile.enabledCategories || ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'],
          };
        }
      }
      if (typeof this.dataSource?.query === 'function') {
        const rows: any[] = await this.dataSource.query(
          'SELECT default_vehicle_type, enabled_categories FROM driver_profiles WHERE user_id = $1',
          [userId],
        );
        if (rows.length > 0) {
          return {
            vehicleType: rows[0].default_vehicle_type || 'CAR',
            enabledCategoryCodes: rows[0].enabled_categories || ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'],
          };
        }
      }
    } catch (error: any) {
      this.logger.warn(`Could not fetch driver preferences for ${userId}: ${error?.message || error}`);
    }
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
    const userId = user?.id ?? user?.sub;
    const vehicleType = dto.vehicleType || 'CAR';
    const enabledCategories = dto.enabledCategoryCodes || ['SPEED_LIMIT', 'WARNING', 'PROHIBITION', 'MANDATORY', 'INFORMATION'];
    try {
      if (this.driverProfileRepo && typeof this.driverProfileRepo.createQueryBuilder === 'function') {
        await this.driverProfileRepo
          .createQueryBuilder()
          .insert()
          .into(DriverProfile)
          .values({
            userId,
            defaultVehicleType: vehicleType,
            enabledCategories,
            updatedAt: new Date(),
          })
          .onConflict('(user_id) DO UPDATE SET default_vehicle_type = :vType, enabled_categories = :cats, updated_at = now()')
          .setParameter('vType', vehicleType)
          .setParameter('cats', enabledCategories)
          .execute();
      } else if (typeof this.dataSource?.query === 'function') {
        await this.dataSource.query(
          `INSERT INTO driver_profiles (user_id, default_vehicle_type, enabled_categories, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id) DO UPDATE SET default_vehicle_type = $2, enabled_categories = $3, updated_at = now()`,
          [userId, vehicleType, enabledCategories],
        );
      }
    } catch (error: any) {
      this.logger.error(`Could not update driver preferences for ${userId}: ${error?.message || error}`);
      throw new BadRequestException('Failed to update navigation preferences');
    }
    return {
      vehicleType,
      enabledCategoryCodes: enabledCategories,
      updated: true,
    };
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Post('sessions/initiate')
  @ApiOperation({
    summary: 'Initiate navigation session with credit gate',
    description: 'Atomically deducts turn-by-turn navigation fee (5 credits) and initiates active session',
  })
  async initiateSession(
    @CurrentUser() user: any,
    @Body() dto: InitiateNavigationSessionDto,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.initiateSession(userId, dto);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Post('sessions/:id/end')
  @ApiOperation({
    summary: 'Conclude active navigation session',
    description: 'Marks navigation session as completed',
  })
  async endSession(
    @CurrentUser() user: any,
    @Param('id') sessionId: string,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.endSession(userId, sessionId);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Get('sessions')
  @ApiOperation({
    summary: 'List user navigation sessions',
    description: 'Paginated list of previous and current navigation sessions',
  })
  async listSessions(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.listSessions(userId, Number(page) || 1, Number(pageSize) || 20);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Post('profiles')
  @ApiOperation({
    summary: 'Create custom alert profile',
    description: 'Creates a custom alert profile and deducts CUSTOM_PROFILE_SPEND fee (20 credits)',
  })
  async createProfile(
    @CurrentUser() user: any,
    @Body() dto: CreateAlertProfileDto,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.createAlertProfile(userId, dto);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Get('profiles')
  @ApiOperation({
    summary: 'List custom alert profiles',
    description: 'Returns all saved custom alert profiles for current driver',
  })
  async listProfiles(@CurrentUser() user: any) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.listAlertProfiles(userId);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Put('profiles/:id/activate')
  @ApiOperation({
    summary: 'Activate a custom alert profile',
    description: 'Sets specified profile active and deactivates others',
  })
  async activateProfile(
    @CurrentUser() user: any,
    @Param('id') profileId: string,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.activateAlertProfile(userId, profileId);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @Delete('profiles/:id')
  @ApiOperation({
    summary: 'Delete a custom alert profile',
    description: 'Permanently remove a custom alert profile by identifier',
  })
  async deleteProfile(
    @CurrentUser() user: any,
    @Param('id') profileId: string,
  ) {
    const userId = user?.id ?? user?.sub;
    return this.creditGate.deleteAlertProfile(userId, profileId);
  }
}
