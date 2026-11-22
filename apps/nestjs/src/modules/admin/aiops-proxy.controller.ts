import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Admin AIOps Governance')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/aiops')
export class AdminAiopsProxyController {
  private readonly logger = new Logger(AdminAiopsProxyController.name);

  constructor(private readonly configService: ConfigService) {}

  private getAiConfigUrl(): { baseUrl: string; internalToken: string } {
    const baseUrl =
      this.configService.get<string>('aiInference.baseUrl') ||
      process.env.AI_INFERENCE_URL ||
      'http://localhost:8001';
    const internalToken =
      this.configService.get<string>('aiInference.internalToken') ||
      process.env.INTERNAL_TOKEN ||
      process.env.INTERNAL_API_TOKEN ||
      'stm_internal_secret_dev';

    return { baseUrl: baseUrl.replace(/\/$/, ''), internalToken };
  }

  @ApiOperation({
    summary: 'Get Edge AI configuration',
    description: 'Proxies authenticated request to Jetson Orin Edge Node with internal token.',
  })
  @ApiResponse({ status: 200, description: 'AI runtime configuration groups' })
  @Get('config')
  async getAiConfig() {
    const { baseUrl, internalToken } = this.getAiConfigUrl();
    try {
      const res = await fetch(`${baseUrl}/api/v1/config`, {
        headers: { 'X-Internal-Token': internalToken },
      });
      if (!res.ok) {
        throw new HttpException(
          `Edge AI config fetch failed with status ${res.status}: ${res.statusText}`,
          res.status,
        );
      }
      return await res.json();
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error connecting to Edge AI node at ${baseUrl}: ${err?.message}`);
      throw new HttpException(
        `Edge AI node connection failed: ${err?.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @ApiOperation({
    summary: 'Update Edge AI configuration group',
    description: 'Proxies authenticated configuration PATCH request to Jetson Orin Edge Node with internal token.',
  })
  @ApiParam({ name: 'group', description: 'Configuration group name (detector, classifier, etc.)', example: 'detector' })
  @ApiResponse({ status: 200, description: 'Updated configuration group' })
  @Patch('config/:group')
  async updateAiConfigGroup(
    @Param('group') group: string,
    @Body() payload: Record<string, any>,
  ) {
    const { baseUrl, internalToken } = this.getAiConfigUrl();
    try {
      const res = await fetch(`${baseUrl}/api/v1/config/${encodeURIComponent(group)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': internalToken,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new HttpException(
          `Edge AI config update failed with status ${res.status}: ${body || res.statusText}`,
          res.status,
        );
      }
      return await res.json();
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error updating Edge AI config group '${group}': ${err?.message}`);
      throw new HttpException(
        `Edge AI node connection failed: ${err?.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @ApiOperation({
    summary: 'Reset Edge AI configuration to defaults',
    description: 'Proxies authenticated configuration reset request to Jetson Orin Edge Node with internal token.',
  })
  @ApiResponse({ status: 200, description: 'Edge AI configuration reset result' })
  @Post('config/reset')
  async resetAiConfig() {
    const { baseUrl, internalToken } = this.getAiConfigUrl();
    try {
      const res = await fetch(`${baseUrl}/api/v1/config/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': internalToken,
        },
      });
      if (!res.ok) {
        throw new HttpException(
          `Edge AI config reset failed with status ${res.status}: ${res.statusText}`,
          res.status,
        );
      }
      return await res.json();
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error resetting Edge AI config: ${err?.message}`);
      throw new HttpException(
        `Edge AI node connection failed: ${err?.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
