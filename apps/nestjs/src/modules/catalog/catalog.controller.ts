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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateSignCategoryDto,
  CreateSignTypeDto,
  ListSignTypesQueryDto,
  UpdateSignCategoryDto,
  UpdateSignTypeDto,
  UpsertSystemParameterDto,
} from './dto/catalog.dto';

@ApiTags('catalog')
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
  @Post('catalog/sign-types')
  createSignType(@Body() dto: CreateSignTypeDto) { return this.svc.createSignType(dto); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update sign type', description: 'Admin operation to modify sign code, standard name, or shape' })
  @Patch('catalog/sign-types/:id')
  updateSignType(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSignTypeDto) { return this.svc.updateSignType(id, dto); }

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
}
