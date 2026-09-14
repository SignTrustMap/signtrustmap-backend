import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NominatimGeocodingClient } from './nominatim-geocoding.client';

describe('NominatimGeocodingClient', () => {
  afterEach(() => jest.restoreAllMocks());

  function service(overrides: Record<string, unknown> = {}) {
    return new NominatimGeocodingClient(
      new ConfigService({
        geocoding: {
          nominatim: {
            baseUrl: 'https://nominatim.test',
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

  it('parses place coordinates, address and bounding box', () => {
    const response = service().parseResponse(
      'Ben Thanh Market',
      JSON.stringify([
        {
          place_id: 12345,
          osm_type: 'way',
          osm_id: 98765,
          name: 'Cho Ben Thanh',
          display_name: 'Cho Ben Thanh, District 1, Ho Chi Minh City, Vietnam',
          lat: '10.7725167',
          lon: '106.6980203',
          category: 'amenity',
          type: 'marketplace',
          importance: 0.62,
          boundingbox: ['10.7719', '10.7731', '106.6974', '106.6986'],
          address: { amenity: 'Cho Ben Thanh', city: 'Ho Chi Minh City', country_code: 'vn' },
        },
      ]),
    );

    expect(response.query).toBe('Ben Thanh Market');
    expect(response.attribution).toBe('Data © OpenStreetMap contributors');
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      providerPlaceId: 12345,
      name: 'Cho Ben Thanh',
      latitude: 10.7725167,
      longitude: 106.6980203,
      address: { city: 'Ho Chi Minh City' },
      boundingBox: { minLongitude: 106.6974 },
    });
  });

  it('handles missing optional fields', () => {
    const response = service().parseResponse(
      'test',
      '[{"place_id":1,"lat":"10.0","lon":"106.0","display_name":"Test"}]',
    );

    expect(response.results[0].osmId).toBeNull();
    expect(response.results[0].boundingBox).toBeNull();
    expect(response.results[0].address).toEqual({});
  });

  it('rejects a partial viewport before calling Nominatim', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(
      service().search({
        query: 'Ben Thanh',
        limit: 5,
        countryCode: 'VN',
        minLatitude: 10.7,
        minLongitude: 106.6,
      }),
    ).rejects.toEqual(
      new BadRequestException('Provide all four viewport values or omit all of them'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the Nominatim request and caches identical searches', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '[]',
    } as Response);
    const client = service();
    const request = {
      query: '  Ben Thanh  ',
      limit: 3,
      countryCode: 'VN',
      minLatitude: 10.7,
      minLongitude: 106.6,
      maxLatitude: 10.9,
      maxLongitude: 106.8,
    };

    await client.search(request);
    await client.search(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/search?format=jsonv2&addressdetails=1&dedupe=1');
    expect(String(url)).toContain('q=Ben+Thanh');
    expect(String(url)).toContain('countrycodes=vn');
    expect(String(url)).toContain('viewbox=106.600000%2C10.900000%2C106.800000%2C10.700000');
    expect(options?.headers).toMatchObject({
      'User-Agent': 'SignTrustMap/test',
      'Accept-Language': 'vi,en',
    });
  });

  it('rejects malformed upstream JSON', () => {
    expect(() => service().parseResponse('test', '{')).toThrow(BadGatewayException);
  });

  it('performs reverse geocoding and returns road name and display location', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        display_name: 'Xa Lo Ha Noi, Hiep Phu, Thu Duc City, Ho Chi Minh City, Vietnam',
        address: { road: 'Xa Lo Ha Noi', city: 'Ho Chi Minh City' },
      }),
    } as unknown as Response));

    const client = service();
    const result = await client.reverse(10.8491, 106.7723);

    expect(result).toEqual({
      displayLocation: 'Xa Lo Ha Noi, Hiep Phu, Thu Duc City, Ho Chi Minh City, Vietnam',
      roadName: 'Xa Lo Ha Noi',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/reverse?format=jsonv2&lat=10.8491&lon=106.7723&addressdetails=1');
  });
});
