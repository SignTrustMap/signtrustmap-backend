import { BadRequestException } from '@nestjs/common';
import {
  SignGeolocationMethod,
  SignGeolocationRequest,
  SignObservation,
} from '../domain/sign-geolocation';
import { SignGeolocationService } from './sign-geolocation.service';

describe('SignGeolocationService', () => {
  const metersPerDegree = 111_320;
  const referenceLatitude = 10;
  const referenceLongitude = 106;
  const metersPerDegreeLongitude =
    metersPerDegree * Math.cos((referenceLatitude * Math.PI) / 180);
  const focalLengthPixels = 320;
  const service = new SignGeolocationService();

  it('triangulates a valid sign from two camera observations', () => {
    const targetX = 10;
    const targetY = 20;
    const response = service.geolocate({
      observations: [
        observation(0, 0, targetX, targetY),
        observation(20, 0, targetX, targetY),
      ],
      horizontalFieldOfViewDegrees: 90,
      imageWidthPixels: 640,
    });

    expect(response.method).toBe(SignGeolocationMethod.TRIANGULATION);
    expect(response.latitude).toBeCloseTo(
      referenceLatitude + targetY / metersPerDegree,
      8,
    );
    expect(response.longitude).toBeCloseTo(
      referenceLongitude + targetX / metersPerDegreeLongitude,
      8,
    );
    expect(response.averageDistanceMeters).toBeCloseTo(Math.hypot(targetX, targetY), 2);
    expect(response.estimatedSignHeightMeters).toBe(0.6);
    expect(response.observationCount).toBe(2);
  });

  it('uses default calibration and assumed height for one observation', () => {
    const response = service.geolocate({
      observations: [
        {
          cameraLatitude: referenceLatitude,
          cameraLongitude: referenceLongitude,
          cameraBearingDegrees: 90,
          detectionBox: { xMin: 300, yMin: 100, xMax: 340, yMax: 132 },
        },
      ],
    });

    expect(response).toEqual({
      latitude: referenceLatitude,
      longitude: Number(
        (referenceLongitude + 6 / metersPerDegreeLongitude).toFixed(8),
      ),
      averageDistanceMeters: 6,
      estimatedSignHeightMeters: 0.6,
      method: SignGeolocationMethod.ASSUMED_HEIGHT,
      observationCount: 1,
    });
  });

  it('falls back for parallel observation rays', () => {
    const request: SignGeolocationRequest = {
      observations: [
        {
          cameraLatitude: referenceLatitude,
          cameraLongitude: referenceLongitude,
          cameraBearingDegrees: 0,
          detectionBox: { xMin: 300, yMin: 100, xMax: 340, yMax: 132 },
        },
        {
          cameraLatitude: referenceLatitude,
          cameraLongitude: referenceLongitude + 10 / metersPerDegreeLongitude,
          cameraBearingDegrees: 0,
          detectionBox: { xMin: 300, yMin: 100, xMax: 340, yMax: 132 },
        },
      ],
      horizontalFieldOfViewDegrees: 90,
      imageWidthPixels: 640,
    };

    const response = service.geolocate(request);

    expect(response.method).toBe(SignGeolocationMethod.ASSUMED_HEIGHT);
    expect(response.averageDistanceMeters).toBe(6);
    expect(response.observationCount).toBe(2);
  });

  it('falls back when triangulation estimates an implausible sign height', () => {
    const first = observation(0, 0, 10, 20);
    const second = observation(20, 0, 10, 20);
    const response = service.geolocate({
      observations: [withBoxHeight(first, 40), withBoxHeight(second, 40)],
      horizontalFieldOfViewDegrees: 90,
      imageWidthPixels: 640,
    });

    expect(response.method).toBe(SignGeolocationMethod.ASSUMED_HEIGHT);
    expect(response.averageDistanceMeters).toBe(4.8);
    expect(response.estimatedSignHeightMeters).toBe(0.6);
  });

  it('rejects detection boxes outside the calibrated image width', () => {
    expect(() =>
      service.geolocate({
        observations: [
          {
            cameraLatitude: referenceLatitude,
            cameraLongitude: referenceLongitude,
            cameraBearingDegrees: 0,
            detectionBox: { xMin: 620, yMin: 100, xMax: 650, yMax: 140 },
          },
        ],
        horizontalFieldOfViewDegrees: 90,
        imageWidthPixels: 640,
      }),
    ).toThrow(
      new BadRequestException(
        'Detection box horizontal coordinates must be inside the image',
      ),
    );
  });

  it('rejects empty observations and locations at a geographic pole', () => {
    expect(() => service.geolocate({ observations: [] })).toThrow(
      'At least one camera observation is required',
    );
    expect(() =>
      service.geolocate({
        observations: [
          {
            cameraLatitude: 90,
            cameraLongitude: 106,
            cameraBearingDegrees: 0,
            detectionBox: { xMin: 300, yMin: 100, xMax: 340, yMax: 132 },
          },
        ],
      }),
    ).toThrow('Geolocation is not supported at the geographic poles');
  });

  function observation(
    cameraX: number,
    cameraY: number,
    targetX: number,
    targetY: number,
  ): SignObservation {
    const deltaX = targetX - cameraX;
    const deltaY = targetY - cameraY;
    const distanceMeters = Math.hypot(deltaX, deltaY);
    const bearingDegrees = normalizeHeading(
      (Math.atan2(deltaX, deltaY) * 180) / Math.PI,
    );
    const boxHeightPixels = (focalLengthPixels * 0.6) / distanceMeters;
    return {
      cameraLatitude: referenceLatitude + cameraY / metersPerDegree,
      cameraLongitude: referenceLongitude + cameraX / metersPerDegreeLongitude,
      cameraBearingDegrees: bearingDegrees,
      detectionBox: {
        xMin: 300,
        yMin: 100,
        xMax: 340,
        yMax: 100 + boxHeightPixels,
      },
    };
  }

  function withBoxHeight(
    observationRequest: SignObservation,
    boxHeightPixels: number,
  ): SignObservation {
    return {
      ...observationRequest,
      detectionBox: {
        ...observationRequest.detectionBox,
        yMax: observationRequest.detectionBox.yMin + boxHeightPixels,
      },
    };
  }

  function normalizeHeading(headingDegrees: number): number {
    return ((headingDegrees % 360) + 360) % 360;
  }
});
