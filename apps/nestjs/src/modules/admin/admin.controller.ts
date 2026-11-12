import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
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
  TriggerRetrainDto,
  CreateFreshnessRuleDto,
  UpdateFreshnessRuleDto,
  UpdateRewardRuleDto,
  UpdateSystemFeatureFlagDto,
  DemoModeToggleDto,
  AdminTaskHistoryQueryDto,
} from './dto/admin.dto';
import { WalletService } from '../wallet/application/wallet.service';
import { SystemSwitchService } from './system-switch.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly walletService: WalletService,
    private readonly systemSwitchService: SystemSwitchService,
  ) { }

  @ApiOperation({
    summary: 'List platform users',
    description: 'Admin operation to search and paginate all users with role, status filtering, and attached activity statistics',
  })
  @ApiQuery({ name: 'role', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'includeStats', required: false, type: Boolean, description: 'Include user performance statistics (default: true)' })
  @Get('users')
  listUsers(
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeStats') includeStats?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    const stats = includeStats === undefined ? true : includeStats !== 'false' && includeStats !== '0';
    return this.svc.listUsers({
      role,
      status,
      search,
      page: Number.isNaN(p) ? 1 : p,
      pageSize: Number.isNaN(ps) ? 20 : ps,
      includeStats: stats,
    });
  }

  @ApiOperation({
    summary: 'Get platform-wide users statistics summary',
    description: 'Admin operation to retrieve overall platform metrics: total users, review accuracy, survey acceptance rate, active contributors',
  })
  @Get('users/statistics/summary')
  getUsersSummaryStatistics() {
    return this.svc.getUsersSummaryStatistics();
  }

  @ApiOperation({
    summary: 'Get detailed user statistics',
    description: 'Admin operation to retrieve comprehensive statistics breakdown for a specific user: reviews, surveys, hazards, navigation, wallet, activity',
  })
  @Get('users/:id/statistics')
  getUserStatistics(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getUserStatistics(id);
  }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({
    summary: 'Get user details by ID',
    description: 'Staff and Admin operation to inspect user profile, identity info, active roles, and performance metrics by UUID',
  })
  @Get('users/:id')
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getUserById(id);
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

  @ApiOperation({ summary: 'Export verified sign dataset', description: 'Admin operation to export all verified signs in JSON, GeoJSON, CSV, or OSM XML formats' })
  @Get('signs/export')
  async exportSigns(
    @Query('format') format?: string,
    @Query('status') status?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    const fmt = (format ?? 'json').toLowerCase();
    const result = await this.svc.exportSigns(fmt, status);
    if (res?.setHeader) {
      if (fmt === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="signtrustmap-signs.csv"');
      } else if (fmt === 'osm') {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="signtrustmap-signs.osm"');
      } else if (fmt === 'geojson') {
        res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
      }
    }
    return result;
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

  // ---------------------------------------------------------------------------
  // Freshness Rules Parameters Management
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Get all freshness rules and field security parameters',
    description: 'Admin operation to view GPS proximity limits, daily submission limits, and freshness period per category',
  })
  @Get('freshness-rules')
  listFreshnessRules() {
    return this.svc.listFreshnessRules();
  }

  @ApiOperation({
    summary: 'Get freshness rule by ID',
    description: 'Admin operation to view specific category freshness and proximity guardrails',
  })
  @Get('freshness-rules/:id')
  getFreshnessRule(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getFreshnessRule(id);
  }

  @ApiOperation({
    summary: 'Create freshness rule for a sign category',
    description: 'Admin operation to establish category freshness period, GPS proximity limit, and daily submission limit',
  })
  @Post('freshness-rules')
  createFreshnessRule(
    @Body() dto: CreateFreshnessRuleDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.createFreshnessRule(dto, user.id, ip);
  }

  @ApiOperation({
    summary: 'Update freshness rule and field security parameters',
    description: 'Admin operation to update GPS max proximity metres, daily submissions limit, or priority with audit logging',
  })
  @Put('freshness-rules/:id')
  updateFreshnessRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFreshnessRuleDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateFreshnessRule(id, dto, user.id, ip);
  }

  @ApiOperation({
    summary: 'Deactivate freshness rule',
    description: 'Admin operation to deactivate category freshness rule with audit logging',
  })
  @Delete('freshness-rules/:id')
  deleteFreshnessRule(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.deleteFreshnessRule(id, user.id, ip);
  }

  // ---------------------------------------------------------------------------
  // Reward Rules Parameters Management
  // ---------------------------------------------------------------------------

  @ApiOperation({
    summary: 'Get all reward rules and credit disbursement parameters',
    description: 'Admin operation to view base reward credits and daily limits for all system activities',
  })
  @Get('reward-rules')
  listRewardRules() {
    return this.svc.listRewardRules();
  }

  @ApiOperation({
    summary: 'Get reward rule by activity type',
    description: 'Admin operation to view specific activity reward parameters (e.g. REVALIDATION_REWARD, REVIEW_REWARD)',
  })
  @Get('reward-rules/:activityType')
  getRewardRule(@Param('activityType') activityType: string) {
    return this.svc.getRewardRule(activityType);
  }

  @ApiOperation({
    summary: 'Update reward rule parameters',
    description: 'Admin operation to update base credit amount, daily limits, and multiplier config with audit logging',
  })
  @Put('reward-rules/:activityType')
  updateRewardRule(
    @Param('activityType') activityType: string,
    @Body() dto: UpdateRewardRuleDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.updateRewardRule(activityType, dto, user.id, ip);
  }

  @ApiOperation({
    summary: 'Trigger automated model retraining run',
    description: 'Admin operation to queue fine-tuning on active learning and consensus datasets',
  })
  @Post('models/retrain')
  triggerModelRetraining(
    @Body() dto: TriggerRetrainDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.triggerModelRetraining(dto, user.id);
  }

  @ApiOperation({
    summary: 'List model retraining jobs',
    description: 'Admin operation to view paginated history of retraining runs, duration, and metrics',
  })
  @Get('models/training-jobs')
  listTrainingJobs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listTrainingJobs({ page: p, pageSize: ps });
  }

  @ApiOperation({
    summary: 'Get training job details',
    description: 'Admin operation to view specific training job details and evaluation summary',
  })
  @Get('models/training-jobs/:id')
  getTrainingJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTrainingJob(id);
  }

  @ApiOperation({
    summary: 'List AI model versions',
    description: 'Admin operation to list active and candidate model versions in registry',
  })
  @Get('models/versions')
  listModelVersions() {
    return this.svc.listModelVersions();
  }

  @ApiOperation({
    summary: 'Promote model version to production',
    description: 'Governed deployment promoting a candidate version to production active with audit logging',
  })
  @Post('models/versions/:id/promote')
  promoteModelVersion(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.promoteModelVersion(id, user.id, ip);
  }

  @ApiOperation({
    summary: 'Rollback model version',
    description: 'Admin operation to rollback model deployment with audit logging',
  })
  @Post('models/versions/:id/rollback')
  rollbackModelVersion(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.svc.rollbackModelVersion(id, user.id, ip);
  }

  @ApiOperation({
    summary: 'Get MLOps pipeline status',
    description: 'Admin operation to retrieve overall status of detection and classification pipeline',
  })
  @Get('models/pipeline/status')
  getPipelineStatus() {
    return this.svc.getPipelineStatus();
  }

  // ── System Feature Switches & Demo Controls ─────────────────────────────────

  @ApiOperation({
    summary: 'List system feature flags and demo mode switches',
    description: 'Admin operation to view all runtime feature toggles and bypass flags',
  })
  @Get('system-switches')
  async listSystemSwitches() {
    return this.systemSwitchService.getAllFlags();
  }

  @ApiOperation({
    summary: 'Update or toggle a specific system feature flag',
    description: 'Admin operation to enable/disable a feature flag with audit logging',
  })
  @Patch('system-switches/:key')
  async updateSystemSwitch(
    @Param('key') key: string,
    @Body() dto: UpdateSystemFeatureFlagDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || null;
    return this.systemSwitchService.setFlag(
      key,
      dto.isEnabled,
      dto.metadata,
      user?.id,
      dto.reason,
      ip,
    );
  }

  @ApiOperation({
    summary: 'Enable Master Demo Mode and all presentation shortcuts',
    description: 'One-click activation of self-review bypass, single-vote consensus, geofence bypass, and testing utilities',
  })
  @Post('system-switches/demo-mode/enable')
  async enableDemoMode(
    @Body() dto: DemoModeToggleDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || null;
    return this.systemSwitchService.enableDemoMode(
      dto?.targetEmail || 'demo@stm.dev',
      user?.id,
      dto?.reason || 'Admin enabled demo mode for live presentation',
      ip,
    );
  }

  @ApiOperation({
    summary: 'Reset system to strict production standards',
    description: 'One-click deactivation of all demo mode switches, quorums, and bypasses',
  })
  @Post('system-switches/demo-mode/disable')
  async disableDemoMode(
    @Body() dto: DemoModeToggleDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers?.['x-forwarded-for'] || null;
    return this.systemSwitchService.disableDemoMode(
      user?.id,
      dto?.reason || 'Admin reset system to strict production standards',
      ip,
    );
  }

  // ── Task History: Surveyor Requests & Review Decisions ─────────────────────

  @ApiOperation({
    summary: 'Get task history with surveyor requests and reviews',
    description: 'Admin operation to view comprehensive history of requests sent to surveyors (evidences, recaptures) and reviews/decisions made to accomplish task X, returning full name and user id of every participant so the admin knows who is doing what.',
  })
  @Get('tasks/:taskId/history')
  getTaskHistory(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.svc.getTaskHistory(taskId);
  }

  @ApiOperation({
    summary: 'List cross-task requests and reviews history',
    description: 'Admin operation to view paginated cross-task activity log of surveyor requests, evidence submissions, and reviewer decisions with user names and IDs',
  })
  @Get('tasks/history')
  listTaskHistory(@Query() query: AdminTaskHistoryQueryDto) {
    return this.svc.listTaskHistory(query);
  }
}

