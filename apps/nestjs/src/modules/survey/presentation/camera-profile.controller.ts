import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CameraProfileService } from '../application/camera-profile.service';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@ApiTags('Survey Submissions')
@ApiBearerAuth()
@Roles('SURVEYOR', 'ADMIN')
@Controller('users/me/camera-profiles')
export class CameraProfileController {
  constructor(private readonly cameraProfileService: CameraProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'List camera calibration profiles',
    description: 'Retrieve all camera calibration profiles registered by the current user',
  })
  async listProfiles(@CurrentUser() user: any) {
    return this.cameraProfileService.getUserProfiles(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create camera calibration profile',
    description: 'Register a new camera calibration profile with vehicle mounting height and tilt angles',
  })
  async createProfile(@CurrentUser() user: any, @Body() dto: CreateCameraProfileDto) {
    return this.cameraProfileService.createProfile(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get camera calibration profile details',
    description: 'Retrieve mounting height, tilt angles, and optical field of view for a specific profile',
  })
  async getProfile(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.cameraProfileService.getProfileById(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update camera calibration profile',
    description: 'Modify mounting height, optical angle offsets, or default status for a profile',
  })
  async updateProfile(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCameraProfileDto,
  ) {
    return this.cameraProfileService.updateProfile(user.id, id, dto);
  }

  @Put(':id/default')
  @ApiOperation({
    summary: 'Set default camera profile',
    description: 'Mark a camera calibration profile as the active default for survey submissions',
  })
  async setDefault(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.cameraProfileService.setDefaultProfile(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete camera calibration profile',
    description: 'Remove a camera calibration profile belonging to the current user',
  })
  async deleteProfile(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.cameraProfileService.deleteProfile(user.id, id);
  }
}
