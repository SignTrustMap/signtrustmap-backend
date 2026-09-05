import { Controller, Get, Patch, Post, Body, Param, Query, ParseUUIDPipe, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { UpdateUserStatusDto, AssignRoleDto } from './dto/admin.dto';
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}
  @Get('users')
  listUsers(@Query('role') role?: string, @Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listUsers({ role, status, search, page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps });
  }
  @Patch('users/:id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() user: any, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateUserStatus(id, dto.status, dto.reason, user.id, ip);
  }
  @Post('users/:id/roles')
  assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto, @CurrentUser() user: any) {
    return this.svc.assignRole(id, dto.roleCode, user.id, dto.isActive ?? true);
  }
  @Get('audit-logs')
  listAuditLogs(@Query('action') action?: string, @Query('resourceName') resourceName?: string, @Query('userId') userId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listAuditLogs({ action, resourceName, userId, page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps });
  }
  @Get('signs/export')
  exportSigns(@Query('format') format?: string, @Query('status') status?: string) {
    return this.svc.exportSigns(format ?? 'json', status);
  }
}
