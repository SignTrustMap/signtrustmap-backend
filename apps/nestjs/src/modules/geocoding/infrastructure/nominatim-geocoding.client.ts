import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeocodingBoundingBoxResponse,
  GeocodingResultResponse,
  GeocodingSearchRequest,
  GeocodingSearchResponse,
  ReverseGeocodingResult,
} from '../domain/geocoding.types';

interface NormalizedSearch extends GeocodingSearchRequest {
  countryCode?: string;
}

interface CacheEntry {
  response: GeocodingSearchResponse;
  expiresAt: number;
}

type JsonObject = Record<string, unknown>;

@Injectable()
export class NominatimGeocodingClient {
  private static readonly ATTRIBUTION = 'Data © OpenStreetMap contributors';

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly acceptLanguage: string;
  private readonly cacheTtlMs: number;
  private readonly minimumRequestIntervalMs: number;
  private readonly maximumCacheEntries: number;
  private readonly cache = new Map<string, CacheEntry>();
  private nextRequestAt = 0;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('geocoding.nominatim.baseUrl') ?? 'https://nominatim.openstreetmap.org';
    this.timeoutMs = config.get<number>('geocoding.nominatim.timeoutMs') ?? 5_000;
    this.userAgent =
      config.get<string>('geocoding.nominatim.userAgent') ?? 'SignTrustMap/0.1 (local development)';
    this.acceptLanguage = config.get<string>('geocoding.nominatim.acceptLanguage') ?? 'vi,en';
    this.cacheTtlMs = config.get<number>('geocoding.nominatim.cacheTtlMs') ?? 10 * 60_000;
    this.minimumRequestIntervalMs =
      config.get<number>('geocoding.nominatim.minimumRequestIntervalMs') ?? 1_000;
    this.maximumCacheEntries =
      config.get<number>('geocoding.nominatim.maximumCacheEntries') ?? 1_000;
  }

  async search(request: GeocodingSearchRequest): Promise<GeocodingSearchResponse> {
    const search = this.normalize(request);
    const cacheKey = this.cacheKey(search);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.response;

    await this.awaitUpstreamRequestSlot();
    const response = await this.fetchResponse(this.searchUrl(search));
    const parsed = this.parseResponse(search.query, response);
    this.putCache(cacheKey, parsed);
    return parsed;
  }

  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<ReverseGeocodingResult> {
    const latRounded = Number(latitude.toFixed(4));
    const lonRounded = Number(longitude.toFixed(4));
    const key = `rev:${latRounded}:${lonRounded}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return (cached as any).reverseResult;
    }

    try {
      await this.awaitUpstreamRequestSlot();
      const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/reverse`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('addressdetails', '1');

      const responseText = await this.fetchResponse(url);
      const data = JSON.parse(responseText);
      const addr = data.address || {};

      const roadName =
        addr.road ||
        addr.street ||
        addr.pedestrian ||
        addr.highway ||
        addr.footway ||
        addr.path ||
        null;

      const communeName =
        addr.quarter ||
        addr.suburb ||
        addr.ward ||
        addr.neighbourhood ||
        addr.village ||
        addr.commune ||
        addr.town ||
        null;

      const provinceName =
        addr.city ||
        addr.province ||
        addr.state ||
        null;

      const displayLocation = data.display_name || `${latRounded}, ${lonRounded}`;

      const result: ReverseGeocodingResult = {
        roadName: roadName ? String(roadName).trim() : null,
        communeName: communeName ? String(communeName).trim() : null,
        provinceName: provinceName ? String(provinceName).trim() : null,
        displayLocation,
      };
      this.cache.set(key, { response: null as any, reverseResult: result, expiresAt: Date.now() + this.cacheTtlMs } as any);
      return result;
    } catch {
      return {
        roadName: null,
        communeName: null,
        provinceName: null,
        displayLocation: `${latRounded}, ${lonRounded}`,
      };
    }
  }

  parseResponse(query: string, body: string): GeocodingSearchResponse {
    let root: unknown;
    try {
      root = JSON.parse(body);
    } catch {
      throw new BadGatewayException('Nominatim geocoding service returned invalid JSON');
    }

    if (!Array.isArray(root)) {
      throw new BadGatewayException('Nominatim geocoding service returned an invalid response');
    }

    return {
      query,
      attribution: NominatimGeocodingClient.ATTRIBUTION,
      results: root.map((place) => this.parsePlace(place)),
    };
  }

  private async fetchResponse(url: URL): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': this.acceptLanguage,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadGatewayException(
          `Nominatim geocoding service returned HTTP ${response.status}`,
        );
      }
      return await response.text();
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (controller.signal.aborted) {
        throw new BadGatewayException('Nominatim geocoding request was interrupted');
      }
      throw new BadGatewayException('Nominatim geocoding service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private parsePlace(value: unknown): GeocodingResultResponse {
    if (!this.isObject(value)) {
      throw new BadGatewayException('Nominatim geocoding service returned an invalid response');
    }

    return {
      providerPlaceId: this.optionalNumber(value.place_id) ?? 0,
      osmType: this.textOrNull(value.osm_type),
      osmId: value.osm_id == null ? null : (this.optionalNumber(value.osm_id) ?? 0),
      name: this.textOrNull(value.name),
      displayName: this.textOrNull(value.display_name),
      latitude: this.requiredNumber(value.lat, 'lat'),
      longitude: this.requiredNumber(value.lon, 'lon'),
      category: this.textOrNull(value.category) ?? this.textOrNull(value.class),
      type: this.textOrNull(value.type),
      importance: value.importance == null ? null : (this.optionalNumber(value.importance) ?? 0),
      boundingBox: this.boundingBox(value.boundingbox),
      address: this.address(value.address),
    };
  }

  private boundingBox(value: unknown): GeocodingBoundingBoxResponse | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    return {
      minLatitude: this.requiredNumber(value[0], 'boundingbox[0]'),
      minLongitude: this.requiredNumber(value[2], 'boundingbox[2]'),
      maxLatitude: this.requiredNumber(value[1], 'boundingbox[1]'),
      maxLongitude: this.requiredNumber(value[3], 'boundingbox[3]'),
    };
  }

  private address(value: unknown): Readonly<Record<string, string>> {
    if (!this.isObject(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field === null || ['string', 'number', 'boolean'].includes(typeof field))
        .map(([key, field]) => [key, String(field)]),
    );
  }

  private normalize(request: GeocodingSearchRequest): NormalizedSearch {
    const query = request.query?.trim() ?? '';
    if (query.length < 2 || query.length > 200) {
      throw new BadRequestException('Geocoding query must contain between 2 and 200 characters');
    }
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 10) {
      throw new BadRequestException('Geocoding result limit must be between 1 and 10');
    }

    const countryCode = request.countryCode?.trim().toLowerCase();
    if (countryCode && !/^[a-z]{2}$/.test(countryCode)) {
      throw new BadRequestException('Country code must contain exactly two letters');
    }

    const viewport = [
      request.minLatitude,
      request.minLongitude,
      request.maxLatitude,
      request.maxLongitude,
    ];
    const suppliedViewportValues = viewport.filter((value) => value != null).length;
    if (suppliedViewportValues !== 0 && suppliedViewportValues !== 4) {
      throw new BadRequestException('Provide all four viewport values or omit all of them');
    }
    if (
      suppliedViewportValues === 4 &&
      (request.minLatitude! >= request.maxLatitude! ||
        request.minLongitude! >= request.maxLongitude!)
    ) {
      throw new BadRequestException('Viewport minimum values must be less than maximum values');
    }

    return { ...request, query, countryCode: countryCode || undefined };
  }

  private searchUrl(search: NormalizedSearch): URL {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/search`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('dedupe', '1');
    url.searchParams.set('q', search.query);
    url.searchParams.set('limit', String(search.limit));
    if (search.countryCode) url.searchParams.set('countrycodes', search.countryCode);
    if (search.minLatitude != null) {
      url.searchParams.set(
        'viewbox',
        [search.minLongitude, search.maxLatitude, search.maxLongitude, search.minLatitude]
          .map((coordinate) => coordinate!.toFixed(6))
          .join(','),
      );
      url.searchParams.set('bounded', '0');
    }
    return url;
  }

  private async awaitUpstreamRequestSlot(): Promise<void> {
    const now = Date.now();
    const requestAt = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = requestAt + this.minimumRequestIntervalMs;
    const waitMs = requestAt - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private putCache(key: string, response: GeocodingSearchResponse): void {
    const now = Date.now();
    for (const [cacheKey, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(cacheKey);
    }
    if (this.cache.size >= this.maximumCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { response, expiresAt: now + this.cacheTtlMs });
  }

  private cacheKey(search: NormalizedSearch): string {
    return JSON.stringify([
      search.query.toLowerCase(),
      search.limit,
      search.countryCode ?? null,
      search.minLatitude ?? null,
      search.minLongitude ?? null,
      search.maxLatitude ?? null,
      search.maxLongitude ?? null,
    ]);
  }

  private requiredNumber(value: unknown, field: string): number {
    if (value == null || (typeof value === 'string' && !value.trim())) {
      throw new BadGatewayException(`Nominatim result is missing ${field}`);
    }
    if (!['string', 'number'].includes(typeof value)) {
      throw new BadGatewayException(`Nominatim result has invalid ${field}`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new BadGatewayException(`Nominatim result has invalid ${field}`);
    }
    return parsed;
  }

  private optionalNumber(value: unknown): number | null {
    if (
      value == null ||
      !['string', 'number'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim())
    ) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private textOrNull(value: unknown): string | null {
    if (value == null || !['string', 'number', 'boolean'].includes(typeof value)) return null;
    const text = String(value).trim();
    return text || null;
  }

  private isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
