import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import {
  UpdateUserStatusDto,
  AssignRoleDto,
  ManualAdjustmentDto,
  FreezeWalletDto,
  UpdateConsensusConfigDto,
  UpdateRouteMatrixDto,
} from './dto/admin.dto';
import { WalletService } from '../wallet/application/wallet.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly walletService: WalletService,
  ) {}

  @ApiOperation({ summary: 'List platform users', description: 'Admin operation to search and paginate all users with role and status filtering' })
  @Get('users')
  listUsers(@Query('role') role?: string, @Query('status') status?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listUsers({ role, status, search, page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps });
  }

  @ApiOperation({ summary: 'Update user account status', description: 'Admin operation to suspend, activate, or ban a user account with recorded audit reason' })
  @Patch('users/:id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() user: any, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateUserStatus(id, dto.status, dto.reason, user.id, ip);
  }

  @ApiOperation({ summary: 'Assign role to user', description: 'Admin operation to grant or revoke roles (e.g. SURVEYOR, REVIEWER, STAFF, ADMIN)' })
  @Post('users/:id/roles')
  assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto, @CurrentUser() user: any) {
    return this.svc.assignRole(id, dto.roleCode, user.id, dto.isActive ?? true);
  }

  @ApiOperation({ summary: 'List security audit logs', description: 'Admin operation to review immutable audit trail of critical actions and IP addresses' })
  @Get('audit-logs')
  listAuditLogs(@Query('action') action?: string, @Query('resourceName') resourceName?: string, @Query('userId') userId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listAuditLogs({ action, resourceName, userId, page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps });
  }

  @ApiOperation({ summary: 'Export verified sign dataset', description: 'Admin operation to export all verified signs in JSON or GeoJSON formats' })
  @Get('signs/export')
  exportSigns(@Query('format') format?: string, @Query('status') status?: string) {
    return this.svc.exportSigns(format ?? 'json', status);
  }

  @ApiOperation({ summary: 'Manual wallet balance adjustment', description: 'Admin operation to manually credit or debit user wallet with mandatory audit reason' })
  @Post('wallets/:id/adjust')
  adjustWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualAdjustmentDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.walletService.manualAdjustment(user.id, id, dto, ip);
  }

  @ApiOperation({ summary: 'Freeze or unfreeze wallet', description: 'Admin operation to freeze or unfreeze user wallet with audit log' })
  @Patch('wallets/:id/freeze')
  freezeWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FreezeWalletDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.walletService.freezeWallet(user.id, id, dto.freeze, dto.reason, ip);
  }

  @ApiOperation({
    summary: 'Get active consensus engine configuration',
    description: 'Admin operation to view Bayesian / weight consensus hyperparameters',
  })
  @Get('consensus/config')
  getConsensusConfig() {
    return this.svc.getConsensusConfig();
  }

  @ApiOperation({
    summary: 'Update consensus engine configuration',
    description: 'Admin operation to update consensus thresholds, weights, and penalty factors with audit logging',
  })
  @Put('consensus/config')
  updateConsensusConfig(
    @Body() dto: UpdateConsensusConfigDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateConsensusConfig(dto, user.id, ip);
  }

  @ApiOperation({
    summary: 'Get route classification freshness decay matrix',
    description: 'Admin operation to view road lifetime and spatial buffer settings',
  })
  @Get('routes/matrix')
  getRouteMatrix() {
    return this.svc.getRouteMatrix();
  }

  @ApiOperation({
    summary: 'Update route classification parameters',
    description: 'Admin operation to update default lifetime, revalidation threshold, or spatial buffer for a route classification',
  })
  @Put('routes/matrix/:id')
  updateRouteMatrix(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRouteMatrixDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateRouteMatrix(id, dto, user.id, ip);
  }
}

