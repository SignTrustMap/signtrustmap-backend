import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateSignCategoryDto,
  CreateSignTypeDto,
  CreateSupportShotDto,
  ListSignTypesQueryDto,
  ReprocessCandidatesDto,
  SetSupportShotPinDto,
  UpdateSignCategoryDto,
  UpdateSignTypeDto,
  UpsertSystemParameterDto,
} from './dto/catalog.dto';

@ApiTags('Catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  // Sign categories: authenticated read, ADMIN write.
  @ApiOperation({ summary: 'List sign categories', description: 'Retrieve all official traffic sign categories (e.g. Warning, Mandatory, Prohibitory)' })
  @Get('catalog/categories')
  listCategories() { return this.svc.listCategories(); }

  @ApiOperation({ summary: 'Get category by ID', description: 'Retrieve single sign category details' })
  @Get('catalog/categories/:id')
  getCategory(@Param('id', ParseIntPipe) id: number) { return this.svc.getCategory(id); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create sign category', description: 'Admin operation to create a new sign category' })
  @Post('catalog/categories')
  createCategory(@Body() dto: CreateSignCategoryDto) { return this.svc.createCategory(dto); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update sign category', description: 'Admin operation to update sign category name or properties' })
  @Patch('catalog/categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSignCategoryDto) { return this.svc.updateCategory(id, dto); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete sign category', description: 'Admin operation to delete an unused sign category' })
  @Delete('catalog/categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteCategory(id); }

  // Traffic sign types: authenticated read, ADMIN write.
  @ApiOperation({ summary: 'List sign types', description: 'Search and filter catalog traffic signs by category, status, and code' })
  @Get('catalog/sign-types')
  listSignTypes(@Query() query: ListSignTypesQueryDto) {
    return this.svc.listSignTypes({
      categoryId: query.categoryId,
      isActive: query.isActive === undefined ? true : query.isActive === 'true',
      search: query.search || query.q,
      page: query.page,
      size: query.size ?? query.pageSize,
    });
  }

  @ApiOperation({ summary: 'Get sign type by ID', description: 'Retrieve single traffic sign type definition, image, and description' })
  @Get('catalog/sign-types/:id')
  getSignType(@Param('id', ParseIntPipe) id: number) { return this.svc.getSignType(id); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create sign type', description: 'Admin operation to define a new traffic sign in the catalog' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Post('catalog/sign-types')
  async createSignType(
    @Body() dto: CreateSignTypeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      dto.representativeImageKey = await this.svc.uploadRepresentativeImage(file, dto.signCode);
    }
    return this.svc.createSignType(dto);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update sign type', description: 'Admin operation to modify sign code, standard name, or shape' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Patch('catalog/sign-types/:id')
  async updateSignType(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSignTypeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      dto.representativeImageKey = await this.svc.uploadRepresentativeImage(file, dto.signCode);
    }
    return this.svc.updateSignType(id, dto);
  }

  @Roles('ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiOperation({
    summary: 'Upload representative image for sign type',
    description: 'Admin-only multipart upload that replaces the primary representative image while retaining prior stored objects.',
  })
  @Post('catalog/sign-types/:id/representative-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadRepresentativeImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.uploadRepresentativeImage(id, file);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete sign type', description: 'Admin operation to soft-delete or remove a sign type' })
  @Delete('catalog/sign-types/:id')
  deleteSignType(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteSignType(id); }

  // System parameters: ADMIN only (Flow 13).
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List system parameters', description: 'Admin operation to retrieve global application configuration parameters' })
  @Get('admin/system-parameters')
  listParams() { return this.svc.listParameters(); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get system parameter by key', description: 'Admin operation to retrieve single configuration parameter' })
  @Get('admin/system-parameters/:key')
  getParam(@Param('key') key: string) { return this.svc.getParameter(key); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Upsert system parameter', description: 'Admin operation to update or insert a system configuration parameter' })
  @Put('admin/system-parameters/:key')
  upsertParam(@Param('key') key: string, @Body() dto: UpsertSystemParameterDto, @CurrentUser() user: any) {
    return this.svc.upsertParameter(key, dto, user.id);
  }

  // --- Support Shots (Few-shot learning) Management: ADMIN / STAFF ---

  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'List support shots for sign type', description: 'Retrieve support shots (anchors & medoids) for a specific sign type' })
  @Get('catalog/sign-types/:id/support-shots')
  listSupportShots(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listSupportShots(id);
  }

  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Add support shot for sign type', description: 'Admin or Staff manually adds a real-photo support shot for a sign type' })
  @Post('catalog/sign-types/:id/support-shots')
  addSupportShot(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSupportShotDto) {
    return this.svc.addSupportShot(id, dto);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete support shot', description: 'Admin deletes a noisy or incorrect support shot' })
  @Delete('catalog/sign-types/:id/support-shots/:imageId')
  deleteSupportShot(@Param('id', ParseIntPipe) id: number, @Param('imageId') imageId: string) {
    return this.svc.deleteSupportShot(id, imageId);
  }

  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Toggle pin status of support shot', description: 'Pin or unpin a support shot to protect it from automatic replacement' })
  @Patch('catalog/sign-types/:id/support-shots/:imageId/pin')
  togglePinSupportShot(@Param('id', ParseIntPipe) id: number, @Param('imageId') imageId: string, @Body() body: SetSupportShotPinDto) {
    return this.svc.setSupportShotPinned(id, imageId, body.isPinned);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Trigger ProtoFuse prototype rebuild', description: 'Admin triggers AI service to recompute ProtoFuse prototypes from database support shots' })
  @Post('catalog/rebuild-prototypes')
  rebuildPrototypes() {
    return this.svc.triggerPrototypeRebuild();
  }

  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Reprocess unresolved candidates against sign type',
    description: 'Scans historical candidates marked unknown or low confidence and upgrades matching instances',
  })
  @Post('catalog/sign-types/:id/reprocess-candidates')
  reprocessCandidates(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: ReprocessCandidatesDto,
  ) {
    return this.svc.reprocessUnknownCandidates(id, body?.similarityThreshold);
  }
}

