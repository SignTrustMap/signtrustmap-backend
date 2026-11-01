import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { HazardsService } from '../application/hazards.service';
import { CreateHazardReportDto } from './dto/create-hazard-report.dto';
import { ConfirmHazardDto } from './dto/confirm-hazard.dto';
import { QueryHazardsDto } from './dto/query-hazards.dto';
import { UploadHazardEvidenceDto } from './dto/upload-hazard-evidence.dto';
import { HazardEvidenceType } from '../infrastructure/persistence/hazard-evidence.entity';

@ApiTags('Hazards')
@Controller()
export class HazardsController {
  constructor(private readonly hazardsService: HazardsService) {}

  /* =========================================================================
   * TEMPORARILY DISABLED: Road hazard functions commented out
   * =========================================================================

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @ApiOperation({
    summary: 'Report roadside hazard',
    description:
      'Report a spontaneous roadside hazard (speed trap, accident, pothole). Includes 300m spatial deduplication and 45-minute micro-TTL initialization.',
  })
  @Post('hazards/report')
  async reportHazard(
    @CurrentUser() user: any,
    @Body() dto: CreateHazardReportDto,
  ) {
    return this.hazardsService.reportHazard(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload image or video evidence for a hazard report' })
  @ApiConsumes('multipart/form-data')
  @Post('hazards/:id/evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: UploadHazardEvidenceDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.hazardsService.uploadEvidence(user.id, id, dto.mediaType as HazardEvidenceType, file);
  }

  @ApiBearerAuth()
  @Roles('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN')
  @ApiOperation({
    summary: 'Confirm or dismiss roadside hazard',
    description:
      'Vote to confirm or dismiss an active hazard alert. Confirmations extend TTL by +15 min (cap 120 min) and trigger consensus payouts at K >= 3.',
  })
  @Post('hazards/:id/confirm')
  async confirmHazard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: ConfirmHazardDto,
  ) {
    return this.hazardsService.confirmHazard(id, user.id, dto);
  }

  @ApiOperation({
    summary: 'List active roadside hazards',
    description:
      'Retrieve unexpired hazards filtered by bounding box or user proximity radius for in-drive navigation safety alerts.',
  })
  @Get('hazards')
  async listHazards(@Query() query: QueryHazardsDto) {
    return this.hazardsService.listHazards(query);
  }

  @ApiOperation({
    summary: 'Get hazard details',
    description: 'Fetch detailed verification status, confirmation counts, and coordinates of a roadside hazard.',
  })
  @Get('hazards/:id')
  async getHazard(@Param('id', ParseUUIDPipe) id: string) {
    return this.hazardsService.getHazard(id);
  }
  ========================================================================= */
}
