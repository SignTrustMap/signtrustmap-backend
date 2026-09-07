import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { HealthService } from '../application/health.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Check API liveness',
    description: 'Confirm that the API process is running and accepting requests.',
  })
  @ApiOkResponse({ description: 'The API process is running.' })
  liveness() {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Check API and database readiness',
    description: 'Confirm that the API can connect to its PostgreSQL database.',
  })
  @ApiOkResponse({ description: 'The API can reach PostgreSQL.' })
  @ApiServiceUnavailableResponse({ description: 'PostgreSQL is unavailable.' })
  readiness() {
    return this.healthService.readiness();
  }
}
