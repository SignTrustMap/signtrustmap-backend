import { RoutingService } from '../application/routing.service';
import { RoutingController } from './routing.controller';

describe('RoutingController', () => {
  it('advertises only vehicle modes supported by the configured OSRM contract', () => {
    const controller = new RoutingController({} as RoutingService);

    expect(controller.vehicleModes()).toEqual({
      defaultMode: 'MOTORCYCLE',
      modes: [
        { id: 'MOTORCYCLE', label: 'Xe máy (Motorcycle)' },
        { id: 'DRIVING', label: 'Ô tô (Car)' },
        { id: 'CYCLING', label: 'Xe đạp (Bicycle)' },
        { id: 'WALKING', label: 'Đi bộ (Walking)' },
      ],
    });
  });
});
