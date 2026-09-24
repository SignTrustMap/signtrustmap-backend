import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { HealthService } from '../application/health.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const healthService = {
    liveness: jest.fn(),
    readiness: jest.fn(),
  } as unknown as HealthService;
  const controller = new HealthController(healthService);

  beforeEach(() => jest.resetAllMocks());

  it('is public and delegates liveness', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBe(true);
    controller.liveness();
    expect(healthService.liveness).toHaveBeenCalled();
  });

  it('delegates readiness', () => {
    controller.readiness();
    expect(healthService.readiness).toHaveBeenCalled();
  });
});
