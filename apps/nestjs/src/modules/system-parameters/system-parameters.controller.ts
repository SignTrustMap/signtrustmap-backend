import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemParametersService } from './system-parameters.service';
import {
  UpdateSystemParameterDto,
  RollbackSystemParameterDto,
  QuerySystemParametersDto,
  SystemParameterResponseDto,
} from './dto/system-parameters.dto';

@ApiTags('Admin System Parameters')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/system-parameters')
export class SystemParametersController {
  constructor(private readonly paramService: SystemParametersService) {}

  @ApiOperation({
    summary: 'List all system parameters with optional category filter',
    description: 'Retrieves the complete registry of operational system parameters including functional domain and input range guidance.',
  })
  @ApiResponse({ status: 200, description: 'List of system parameters with domain and range', type: [SystemParameterResponseDto] })
  @Get()
  async listParameters(@Query() query: QuerySystemParametersDto): Promise<SystemParameterResponseDto[]> {
    return (await this.paramService.getAll(query.category, query.search)) as any;
  }

  @ApiOperation({
    summary: 'Get single system parameter details by key',
    description: 'Retrieves metadata, validation schema, functional domain, input range guidance, and current value for a specified configuration key.',
  })
  @ApiParam({ name: 'key', description: 'Parameter unique key identifier', example: 'hazards.initial_ttl_minutes' })
  @ApiResponse({ status: 200, description: 'Parameter details with domain and range', type: SystemParameterResponseDto })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  @Get(':key')
  async getParameter(@Param('key') key: string): Promise<SystemParameterResponseDto> {
    const param = await this.paramService.get(key);
    if (!param) {
      throw new NotFoundException(`Parameter '${key}' not found.`);
    }
    return param as any;
  }

  @ApiOperation({
    summary: 'Update system parameter value with operational audit trail',
    description: 'Validates and persists a new value for a parameter, creates an immutable audit log, and emits cluster-wide invalidation event.',
  })
  @ApiParam({ name: 'key', description: 'Parameter unique key identifier', example: 'hazards.initial_ttl_minutes' })
  @ApiResponse({ status: 200, description: 'Updated system parameter with domain and range', type: SystemParameterResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid value or missing change reason' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires ADMIN role' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  @Put(':key')
  async updateParameter(
    @Param('key') key: string,
    @Body() dto: UpdateSystemParameterDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<SystemParameterResponseDto> {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    return (await this.paramService.update(
      key,
      dto.value,
      dto.changeReason,
      user.id,
      ip,
      userAgent,
    )) as any;
  }

  @ApiOperation({
    summary: 'Get chronological audit log history for a parameter',
    description: 'Returns historical modifications, including previous and new values, timestamps, and administrator reasons.',
  })
  @ApiParam({ name: 'key', description: 'Parameter unique key identifier', example: 'hazards.initial_ttl_minutes' })
  @ApiResponse({ status: 200, description: 'List of audit log records' })
  @Get(':key/audit-history')
  async getAuditHistory(
    @Param('key') key: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.paramService.getAuditHistory(key, parsedLimit);
  }

  @ApiOperation({
    summary: 'Rollback a parameter to a previous historical version',
    description: 'Restores the value from a specific audit log record and logs a rollback event.',
  })
  @ApiParam({ name: 'key', description: 'Parameter unique key identifier', example: 'hazards.initial_ttl_minutes' })
  @ApiResponse({ status: 200, description: 'Parameter restored to target historical version', type: SystemParameterResponseDto })
  @ApiResponse({ status: 400, description: 'Rollback validation failed' })
  @ApiResponse({ status: 404, description: 'Target audit log record not found' })
  @HttpCode(HttpStatus.OK)
  @Put(':key/rollback')
  async rollbackParameter(
    @Param('key') key: string,
    @Body() dto: RollbackSystemParameterDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<SystemParameterResponseDto> {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    return (await this.paramService.rollback(
      key,
      dto.targetAuditId,
      dto.changeReason,
      user.id,
      ip,
      userAgent,
    )) as any;
  }
}
