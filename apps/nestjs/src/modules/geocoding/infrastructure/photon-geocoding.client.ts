import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeocodingBoundingBoxResponse,
  GeocodingResultResponse,
  GeocodingSearchRequest,
  GeocodingSearchResponse,
  ReverseGeocodingResult,
} from '../domain/geocoding.types';

import { formatCanonicalRoadName } from '../../spatial-admin/domain/road-name-formatter';

interface NormalizedSearch extends GeocodingSearchRequest {
  countryCode?: string;
}

interface CacheEntry {
  response: GeocodingSearchResponse;
  expiresAt: number;
}

@Injectable()
export class PhotonGeocodingClient {
  private static readonly ATTRIBUTION = 'Data © OpenStreetMap contributors (Photon)';

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
    this.baseUrl =
      config.get<string>('geocoding.photon.baseUrl') ??
      config.get<string>('geocoding.nominatim.baseUrl') ??
      'https://photon.komoot.io';
    this.timeoutMs = config.get<number>('geocoding.photon.timeoutMs') ?? 5_000;
    this.userAgent =
      config.get<string>('geocoding.photon.userAgent') ?? 'SignTrustMap/0.1 (local development)';
    this.acceptLanguage = config.get<string>('geocoding.photon.acceptLanguage') ?? 'vi,en';
    this.cacheTtlMs = config.get<number>('geocoding.photon.cacheTtlMs') ?? 10 * 60_000;
    this.minimumRequestIntervalMs =
      config.get<number>('geocoding.photon.minimumRequestIntervalMs') ?? 100;
    this.maximumCacheEntries =
      config.get<number>('geocoding.photon.maximumCacheEntries') ?? 1_000;
  }

  async search(request: GeocodingSearchRequest): Promise<GeocodingSearchResponse> {
    const search = this.normalize(request);
    const cacheKey = this.cacheKey(search);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.response;

    await this.awaitUpstreamRequestSlot();
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/api/`);
    url.searchParams.set('q', search.query);
    url.searchParams.set('limit', String(search.limit));
    if (search.countryCode) {
      url.searchParams.set('countrycode', search.countryCode);
    }

    const response = await this.fetchResponse(url);
    const parsed = this.parseResponse(search.query, response);
    this.putCache(cacheKey, parsed);
    return parsed;
  }

  async reverse(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
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
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));

      const responseText = await this.fetchResponse(url);
      const data = JSON.parse(responseText);
      const feature = data.features?.[0];

      if (feature) {
        const props = feature.properties || {};
        const rawRoadName =
          props.street ||
          (props.osm_key === 'highway' || props.type === 'street' ? props.name : null) ||
          null;
        const roadName = formatCanonicalRoadName(rawRoadName);

        let communeName =
          props.district ||
          props.suburb ||
          props.quarter ||
          props.locality ||
          props.neighbourhood ||
          null;

        const provinceName = props.city || props.state || null;

        if (
          communeName &&
          !communeName.startsWith('Phường ') &&
          !communeName.startsWith('Xã ') &&
          !communeName.startsWith('Thị trấn ')
        ) {
          communeName = `Phường ${communeName}`;
        }

        const displayLocation =
          [roadName, communeName, provinceName].filter(Boolean).join(', ') ||
          `${latRounded}, ${lonRounded}`;

        const result: ReverseGeocodingResult = {
          roadName: roadName ? String(roadName).trim() : null,
          communeName: communeName ? String(communeName).trim() : null,
          provinceName: provinceName ? String(provinceName).trim() : null,
          displayLocation,
        };

        this.cache.set(key, {
          response: null as any,
          reverseResult: result,
          expiresAt: Date.now() + this.cacheTtlMs,
        } as any);

        return result;
      }

      return {
        roadName: null,
        communeName: null,
        provinceName: null,
        displayLocation: `${latRounded}, ${lonRounded}`,
      };
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
      throw new BadGatewayException('Geocoding service returned invalid JSON');
    }

    let results: GeocodingResultResponse[] = [];

    if (this.isObject(root) && Array.isArray((root as any).features)) {
      const features = (root as any).features;
      results = features.map((f: any) => {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates || [0, 0];
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        const extent = props.extent;

        return {
          providerPlaceId: Number(props.osm_id) || 0,
          osmType: props.osm_type || 'N',
          osmId: props.osm_id == null ? null : (Number(props.osm_id) || 0),
          name: props.name || '',
          displayName: [props.name, props.street, props.district, props.city, props.country]
            .filter(Boolean)
            .join(', '),
          latitude: lat,
          longitude: lon,
          category: props.osm_key || null,
          type: props.osm_value || props.type || null,
          importance: 0.5,
          boundingBox:
            Array.isArray(extent) && extent.length >= 4
              ? {
                  minLatitude: Number(extent[1]),
                  maxLatitude: Number(extent[3]),
                  minLongitude: Number(extent[0]),
                  maxLongitude: Number(extent[2]),
                }
              : null,
          address: {
            road: formatCanonicalRoadName(props.street || '') || '',
            suburb: props.district || '',
            city: props.city || props.state || '',
            country: props.country || 'Việt Nam',
          },
        };
      });
    } else {
      throw new BadGatewayException('Photon geocoding service returned an invalid response');
    }

    return {
      query,
      attribution: PhotonGeocodingClient.ATTRIBUTION,
      results,
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
        throw new BadGatewayException(`Geocoding service returned HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (controller.signal.aborted) {
        throw new BadGatewayException('Geocoding request was interrupted');
      }
      throw new BadGatewayException('Geocoding service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
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

    return { ...request, query, countryCode: countryCode || undefined };
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

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
