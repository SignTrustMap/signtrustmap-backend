import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RouteDirectionsRequestDto } from './routing.dto';

describe('RouteDirectionsRequestDto validation', () => {
  it('passes on valid coordinates', async () => {
    const dto = plainToInstance(RouteDirectionsRequestDto, {
      vehicleMode: 'DRIVING',
      vehicleType: 'CAR',
      originLatitude: 10.7949,
      originLongitude: 106.7218,
      destinationLatitude: 10.7725,
      destinationLongitude: 106.698,
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects boolean false on destinationLatitude (Schemathesis regression)', async () => {
    const dto = plainToInstance(RouteDirectionsRequestDto, {
      vehicleMode: 'DRIVING',
      vehicleType: 'CAR',
      enabledCategoryCodes: ['SPEED_LIMIT', 'WARNING'],
      originLatitude: 10.7949,
      originLongitude: 106.7218,
      destinationLatitude: false,
      destinationLongitude: 106.698,
      alternativeThresholdPercent: 0,
      maxAlternatives: 0,
      snapRadiusMeters: 100,
      _vehicleMode: '',
    });
    const errors = await validate(dto);
    const destError = errors.find((e) => e.property === 'destinationLatitude');
    expect(destError).toBeDefined();
    expect(destError?.constraints).toHaveProperty('isNumber');
  });

  it('rejects boolean false on originLatitude', async () => {
    const dto = plainToInstance(RouteDirectionsRequestDto, {
      originLatitude: false,
      originLongitude: 106.7218,
      destinationLatitude: 10.7725,
      destinationLongitude: 106.698,
    });
    const errors = await validate(dto);
    const originError = errors.find((e) => e.property === 'originLatitude');
    expect(originError).toBeDefined();
    expect(originError?.constraints).toHaveProperty('isNumber');
  });

  it('rejects non-numeric string coordinates', async () => {
    const dto = plainToInstance(RouteDirectionsRequestDto, {
      originLatitude: 'not-a-number',
      originLongitude: 106.7218,
      destinationLatitude: 10.7725,
      destinationLongitude: 106.698,
    });
    const errors = await validate(dto);
    const originError = errors.find((e) => e.property === 'originLatitude');
    expect(originError).toBeDefined();
    expect(originError?.constraints).toHaveProperty('isNumber');
  });
});
