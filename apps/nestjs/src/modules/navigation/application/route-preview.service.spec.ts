import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { encodePolyline } from '../domain/encoded-polyline';
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
        distanceMeters: 1_500.4,
        durationSeconds: 180.2,
        distanceRatioToShortest: 1,
        nodeIds: [],
        edgeIds: [],
        geometry,
        steps: [
          {
            type: 'turn',
            instruction: 'Turn right onto Le Loi',
            edgeId: null,
            fromNodeId: null,
            toNodeId: null,
            roadName: 'Le Loi',
            roadClass: 'driving',
            distanceMeters: 119.7,
            durationSeconds: 20,
            geometry: geometry.slice(0, 2),
          },
        ],
      },
      alternatives: [],
    };
    const upcomingSigns = {
      routeDistanceMeters: 1_500,
      corridorWidthMeters: 30,
      signCount: 2,
      signs: [
        {
          distanceAlongRouteMeters: 819.6,
          distanceFromRouteMeters: 4,
          sign: sign('sign-3892', 'SPEED_LIMIT', 50, 10.006, 106.005),
        },
        {
          distanceAlongRouteMeters: 1_430.2,
          distanceFromRouteMeters: 8,
          sign: sign('sign-4112', 'NO_LEFT_TURN', null, 10.009, 106.009),
        },
      ],
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

    await expect(service.previewRoute(request)).resolves.toEqual({
      route: {
        geometry: encodePolyline(geometry),
        distanceMeters: 1_500,
        durationSeconds: 180,
      },
      steps: [
        {
          type: 'turn',
          instruction: 'Turn right onto Le Loi',
          distanceMeters: 120,
        },
      ],
      trafficSigns: [
        {
          id: 'sign-3892',
          type: 'SPEED_LIMIT',
          value: 50,
          lat: 10.006,
          lon: 106.005,
          routeOffsetMeters: 820,
        },
        {
          id: 'sign-4112',
          type: 'NO_LEFT_TURN',
          lat: 10.009,
          lon: 106.009,
          routeOffsetMeters: 1_430,
        },
      ],
    });
    expect(routing.findDirections).toHaveBeenCalledWith(request);
    expect(routeSigns.findAlongRoute).toHaveBeenCalledWith({ geometry });
  });

  function sign(
    id: string,
    signCode: string,
    value: number | null,
    latitude: number,
    longitude: number,
  ) {
    return {
      id,
      latitude,
      longitude,
      trafficDirection: null,
      signCropUrl: `${id}.jpg`,
      status: 'ACTIVE',
      freshnessScore: 1,
      lastVerifiedAt: new Date('2026-09-06T00:00:00Z'),
      createdAt: new Date('2026-09-06T00:00:00Z'),
      updatedAt: new Date('2026-09-06T00:00:00Z'),
      signType: {
        id: 1,
        categoryId: 1,
        signCode,
        nameVi: signCode,
        nameEn: signCode,
        description: null,
        labelingGuidelines: null,
        shape: null,
        colorScheme: null,
        isActive: true,
        value,
        category: {
          id: 1,
          code: 'PROHIBITORY',
          nameVi: 'Prohibitory',
          nameEn: 'Prohibitory',
        },
      },
    };
  }
});
