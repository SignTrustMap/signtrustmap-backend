import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteDirectionsRequestDto } from '../presentation/dto/routing.dto';
import { OsrmRoutingClient } from './osrm-routing.client';

describe('OsrmRoutingClient', () => {
  afterEach(() => jest.restoreAllMocks());

  const request: RouteDirectionsRequestDto = {
    originLatitude: 10.762622,
    originLongitude: 106.660172,
    destinationLatitude: 10.776889,
    destinationLongitude: 106.700806,
    alternativeThresholdPercent: 25,
    maxAlternatives: 3,
    snapRadiusMeters: 1_000,
  };

  function client() {
    return new OsrmRoutingClient(
      new ConfigService({
        routing: {
          osrm: {
            baseUrl: 'https://osrm.test/',
            profile: 'driving',
            motorcycleProfile: 'motorcycle',
            timeoutMs: 1_000,
          },
        },
      }),
    );
  }

  const fixture = JSON.stringify({
    code: 'Ok',
    waypoints: [
      { distance: 7.5, location: [106.6601, 10.7626] },
      { distance: 9, location: [106.7009, 10.7769] },
    ],
    routes: [
      {
        distance: 1200,
        duration: 180,
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.6601, 10.7626],
            [106.67, 10.77],
            [106.7009, 10.7769],
          ],
        },
        legs: [
          {
            steps: [
              {
                name: 'Alternative Road',
                mode: 'driving',
                maneuver: { type: 'depart', modifier: 'straight' },
                distance: 1200,
                duration: 180,
                geometry: { coordinates: [[106.6601, 10.7626], [106.7009, 10.7769]] },
              },
            ],
          },
        ],
      },
      {
        distance: 1000,
        duration: 160,
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.6601, 10.7626],
            [106.68, 10.77],
            [106.7009, 10.7769],
          ],
        },
        legs: [
          {
            steps: [
              {
                name: 'Shortest Road',
                mode: 'driving',
                maneuver: { type: 'turn', modifier: 'right' },
                distance: 1000,
                duration: 160,
                geometry: { coordinates: [[106.6601, 10.7626], [106.7009, 10.7769]] },
              },
            ],
          },
        ],
      },
      {
        distance: 1400,
        duration: 190,
        geometry: { coordinates: [[106.6601, 10.7626], [106.7009, 10.7769]] },
        legs: [{ steps: [] }],
      },
    ],
  });

  it('parses the shortest route and alternatives within the threshold', () => {
    const response = client().parseResponse(request, 25, 3, fixture);

    expect(response.shortestPath.distanceMeters).toBe(1000);
    expect(response.shortestPath.recommendation).toBe('Shortest route');
    expect(response.shortestPath.steps[0].roadName).toBe('Shortest Road');
    expect(response.shortestPath.steps[0]).toMatchObject({
      type: 'turn',
      instruction: 'Turn right onto Shortest Road',
    });
    expect(response.alternatives).toHaveLength(1);
    expect(response.alternatives[0].distanceMeters).toBe(1200);
    expect(response.alternatives[0].recommendation).toContain('20.0%');
    expect(response.snappedOrigin.latitude).toBe(10.7626);
    expect(response.snappedDestination.longitude).toBe(106.7009);
  });

  it('requests GeoJSON routes from the configured OSRM endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    await client().findDirections(request, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      '/route/v1/driving/106.6601720,10.7626220;106.7008060,10.7768890',
    );
    expect(url).toContain('alternatives=3');
    expect(url).toContain('steps=true');
    expect(url).toContain('geometries=geojson');
    expect(url).toContain('overview=full');
  });

  it('maps non-successful OSRM HTTP responses to a bad gateway', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '',
    } as Response);

    await expect(client().findDirections(request, 25, 3)).rejects.toEqual(
      new BadGatewayException('OSRM routing service returned HTTP 503'),
    );
  });

  it('maps OSRM HTTP 400 responses to BadRequestException instead of 502 Bad Gateway', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Could not find a matching segment for coordinate' }),
      text: async () => '{"message":"Could not find a matching segment for coordinate"}',
    } as Response);

    await expect(client().findDirections(request, 25, 3)).rejects.toEqual(
      new BadRequestException(
        'OSRM routing service returned HTTP 400: Could not find a matching segment for coordinate',
      ),
    );
  });

  it('maps OSRM HTTP 404 responses to NotFoundException', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'No route' }),
      text: async () => '{"message":"No route"}',
    } as Response);

    await expect(client().findDirections(request, 25, 3)).rejects.toEqual(
      new NotFoundException('No route found between the specified coordinates'),
    );
  });

  it('routes with bicycle profile and calibrates duration to cycling speed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    const bicycleRequest: RouteDirectionsRequestDto = {
      ...request,
      vehicleType: 'BICYCLE',
    };

    const response = await client().findDirections(bicycleRequest, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/route/v1/bike/');
    expect(response.shortestPath.recommendation).toBe('Shortest route (Bicycle)');
    // 1000m at 4.17 m/s (~15 km/h) = ~240s, compared to 160s car driving
    expect(response.shortestPath.durationSeconds).toBe(240);
    expect(response.shortestPath.steps[0].roadClass).toBe('cycling');
  });

  it('routes with pedestrian profile and calibrates duration to walking speed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    const pedestrianRequest: RouteDirectionsRequestDto = {
      ...request,
      vehicleType: 'PEDESTRIAN',
    };

    const response = await client().findDirections(pedestrianRequest, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/route/v1/foot/');
    expect(response.shortestPath.recommendation).toBe('Shortest route (Pedestrian)');
    // 1000m at 1.33 m/s (~4.8 km/h) = ~752s
    expect(response.shortestPath.durationSeconds).toBe(752);
    expect(response.shortestPath.steps[0].roadClass).toBe('walking');
  });

  it('falls back to driving profile when a specialized profile returns an error', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Profile not found',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => fixture,
      } as Response);

    const bicycleRequest: RouteDirectionsRequestDto = {
      ...request,
      vehicleType: 'BICYCLE',
    };

    const response = await client().findDirections(bicycleRequest, 25, 3);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/route/v1/bike/');
    expect(response.shortestPath.distanceMeters).toBe(1000);
    expect(response.shortestPath.durationSeconds).toBe(240);
  });

  it('routes with a motorcycle profile and calibrates duration with motorcycle factor', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    const motorcycleRequest: RouteDirectionsRequestDto = {
      ...request,
      vehicleType: 'MOTORCYCLE',
    };

    const response = await client().findDirections(motorcycleRequest, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/route/v1/motorcycle/');
    expect(response.shortestPath.recommendation).toBe('Shortest route (Motorcycle)');
    // 160s * 0.95 = 152s
    expect(response.shortestPath.durationSeconds).toBe(152);
  });

  it('routes with vehicleMode BIKE resolving to motorcycle', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    const bikeRequest: RouteDirectionsRequestDto = {
      ...request,
      vehicleMode: 'BIKE',
    };

    const response = await client().findDirections(bikeRequest, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/route/v1/motorcycle/');
    expect(response.shortestPath.recommendation).toBe('Shortest route (Motorcycle)');
    expect(response.shortestPath.durationSeconds).toBe(152);
  });

  it('routes with _vehicleMode BIKE resolving to motorcycle', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture,
    } as Response);

    const bikeRequest: RouteDirectionsRequestDto = {
      ...request,
      _vehicleMode: 'BIKE',
    };

    const response = await client().findDirections(bikeRequest, 25, 3);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/route/v1/motorcycle/');
    expect(response.shortestPath.recommendation).toBe('Shortest route (Motorcycle)');
    expect(response.shortestPath.durationSeconds).toBe(152);
  });
});
