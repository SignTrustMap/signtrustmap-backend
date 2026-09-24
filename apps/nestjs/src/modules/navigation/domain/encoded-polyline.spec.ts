import { encodePolyline } from './encoded-polyline';

describe('encodePolyline', () => {
  it('encodes route points using the standard precision-5 format', () => {
    expect(
      encodePolyline([
        { latitude: 38.5, longitude: -120.2 },
        { latitude: 40.7, longitude: -120.95 },
        { latitude: 43.252, longitude: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
});
