import { RoutingService } from './routing.service';
import { OsrmRoutingClient } from '../infrastructure/osrm-routing.client';

describe('RoutingService', () => {
  it('applies the Spring defaults when route options are omitted', async () => {
    const osrm = {
      findDirections: jest.fn().mockResolvedValue({}),
    } as unknown as OsrmRoutingClient;
    const service = new RoutingService(osrm);
    const request = {
      originLatitude: 10,
      originLongitude: 106,
      destinationLatitude: 11,
      destinationLongitude: 107,
    };

    await service.findDirections(request);

    expect(osrm.findDirections).toHaveBeenCalledWith(request, 15, 3);
  });
});
