import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { RoutingService } from './routing.service';
import { RoutePreviewService } from './route-preview.service';

describe('RoutePreviewService', () => {
  it('combines directions with signs from the shortest path geometry', async () => {
    const geometry = [
      { latitude: 10, longitude: 106 },
      { latitude: 10.005, longitude: 106.004 },
      { latitude: 10.01, longitude: 106.01 },
    ];
    const directions = {
      origin: geometry[0],
      destination: geometry[2],
      snappedOrigin: { ...geometry[0], nodeId: null, distanceMeters: 0 },
      snappedDestination: { ...geometry[2], nodeId: null, distanceMeters: 0 },
      shortestPath: {
        rank: 1,
        primary: true,
        recommendation: 'Shortest route',
        distanceMeters: 1_500,
        durationSeconds: 180,
        distanceRatioToShortest: 1,
        nodeIds: [],
        edgeIds: [],
        geometry,
        steps: [],
      },
      alternatives: [],
    };
    const upcomingSigns = {
      routeDistanceMeters: 1_500,
      corridorWidthMeters: 30,
      signCount: 0,
      signs: [],
    };
    const routing = {
      findDirections: jest.fn().mockResolvedValue(directions),
    } as unknown as RoutingService;
    const routeSigns = {
      findAlongRoute: jest.fn().mockResolvedValue(upcomingSigns),
    } as unknown as RouteSignQueryService;
    const service = new RoutePreviewService(routing, routeSigns);
    const request = {
      originLatitude: 10,
      originLongitude: 106,
      destinationLatitude: 10.01,
      destinationLongitude: 106.01,
      maxAlternatives: 2,
    };

    await expect(service.previewRoute(request)).resolves.toEqual({ directions, upcomingSigns });
    expect(routing.findDirections).toHaveBeenCalledWith(request);
    expect(routeSigns.findAlongRoute).toHaveBeenCalledWith({ geometry });
  });
});
