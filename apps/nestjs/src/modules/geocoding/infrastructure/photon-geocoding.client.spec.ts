import { ConfigService } from '@nestjs/config';
import { PhotonGeocodingClient } from './photon-geocoding.client';

describe('PhotonGeocodingClient', () => {
  afterEach(() => jest.restoreAllMocks());

  function service(overrides: Record<string, unknown> = {}) {
    return new PhotonGeocodingClient(
      new ConfigService({
        geocoding: {
          photon: {
            baseUrl: 'https://photon.test',
            timeoutMs: 1_000,
            userAgent: 'SignTrustMap/test',
            acceptLanguage: 'vi,en',
            cacheTtlMs: 60_000,
            minimumRequestIntervalMs: 0,
            maximumCacheEntries: 10,
            ...overrides,
          },
        },
      }),
    );
  }

  it('parses place coordinates, address and bounding box from Photon GeoJSON', () => {
    const response = service().parseResponse(
      'Ben Thanh Market',
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [106.6980203, 10.7725167],
            },
            properties: {
              osm_id: 12345,
              osm_type: 'W',
              name: 'Cho Ben Thanh',
              street: 'Lê Lợi',
              district: 'Bến Nghé',
              city: 'Thành phố Hồ Chí Minh',
              country: 'Việt Nam',
              osm_key: 'amenity',
              osm_value: 'marketplace',
              extent: [106.6974, 10.7719, 106.6986, 10.7731],
            },
          },
        ],
      }),
    );

    expect(response.query).toBe('Ben Thanh Market');
    expect(response.attribution).toBe('Data © OpenStreetMap contributors (Photon)');
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      providerPlaceId: 12345,
      name: 'Cho Ben Thanh',
      latitude: 10.7725167,
      longitude: 106.6980203,
      address: { city: 'Thành phố Hồ Chí Minh', road: 'Lê Lợi' },
      boundingBox: { minLongitude: 106.6974 },
    });
  });

  it('handles missing optional fields in Photon response', () => {
    const response = service().parseResponse(
      'test',
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [106.0, 10.0],
            },
            properties: {},
          },
        ],
      }),
    );

    expect(response.results[0].latitude).toBe(10.0);
    expect(response.results[0].longitude).toBe(106.0);
    expect(response.results[0].boundingBox).toBeNull();
  });
});
