import { Controller, Get, Post, Patch, Delete, Put, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateSignCategoryDto, UpdateSignCategoryDto, CreateSignTypeDto, UpdateSignTypeDto, UpsertSystemParameterDto } from './dto/catalog.dto';

@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  // ── Sign Categories: public read, ADMIN write ───────────────────────────
  @Get('catalog/categories')
  listCategories() { return this.svc.listCategories(); }

  @Get('catalog/categories/:id')
  getCategory(@Param('id', ParseIntPipe) id: number) { return this.svc.getCategory(id); }

  @Roles('ADMIN')
  @Post('catalog/categories')
  createCategory(@Body() dto: CreateSignCategoryDto) { return this.svc.createCategory(dto); }

  @Roles('ADMIN')
  @Patch('catalog/categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSignCategoryDto) { return this.svc.updateCategory(id, dto); }

  @Roles('ADMIN')
  @Delete('catalog/categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteCategory(id); }

  // ── Traffic Sign Types: public read, ADMIN write ────────────────────────
  @Get('catalog/sign-types')
  listSignTypes(@Query('categoryId') categoryId?: string, @Query('isActive') isActive?: string, @Query('search') search?: string, @Query('q') q?: string) {
    const cid = categoryId !== undefined ? parseInt(categoryId, 10) : undefined;
    const act = isActive !== undefined ? isActive === 'true' : undefined;
    const term = (search ?? q ?? '').trim() || undefined;
    return this.svc.listSignTypes(Number.isNaN(cid as any) ? undefined : cid, act, term);
  }

  @Get('catalog/sign-types/:id')
  getSignType(@Param('id', ParseIntPipe) id: number) { return this.svc.getSignType(id); }

  @Roles('ADMIN')
  @Post('catalog/sign-types')
  createSignType(@Body() dto: CreateSignTypeDto) { return this.svc.createSignType(dto); }

  @Roles('ADMIN')
  @Patch('catalog/sign-types/:id')
  updateSignType(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSignTypeDto) { return this.svc.updateSignType(id, dto); }

  @Roles('ADMIN')
  @Delete('catalog/sign-types/:id')
  deleteSignType(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteSignType(id); }

  // ── System Parameters: ADMIN only (Flow 13) ─────────────────────────────
  @Roles('ADMIN')
  @Get('admin/system-parameters')
  listParams() { return this.svc.listParameters(); }

  @Roles('ADMIN')
  @Get('admin/system-parameters/:key')
  getParam(@Param('key') key: string) { return this.svc.getParameter(key); }

  @Roles('ADMIN')
  @Put('admin/system-parameters/:key')
  upsertParam(@Param('key') key: string, @Body() dto: UpsertSystemParameterDto, @CurrentUser() user: any) {
    return this.svc.upsertParameter(key, dto, user.id);
  }
}
