import { RoutingService } from '../application/routing.service';
import { RoutingController } from './routing.controller';

describe('RoutingController', () => {
  it('advertises only vehicle modes supported by the configured OSRM contract', () => {
    const controller = new RoutingController({} as RoutingService);

    expect(controller.vehicleModes()).toEqual({
      defaultMode: 'DRIVING',
      modes: [{ id: 'DRIVING', label: 'Driving' }],
    });
  });
});
