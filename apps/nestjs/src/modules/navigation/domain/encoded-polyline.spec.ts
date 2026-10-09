import { decodePolyline, encodePolyline } from './encoded-polyline';

describe('encoded-polyline', () => {
  it('encodes route points using the standard precision-5 format', () => {
    expect(
      encodePolyline([
        { latitude: 38.5, longitude: -120.2 },
        { latitude: 40.7, longitude: -120.95 },
        { latitude: 43.252, longitude: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('decodes encoded polylines back to route points', () => {
    const original = [
      { latitude: 10.7769, longitude: 106.7009 },
      { latitude: 10.78, longitude: 106.705 },
      { latitude: 10.8, longitude: 106.72 },
    ];
    const encoded = encodePolyline(original);
    const decoded = decodePolyline(encoded);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].latitude).toBeCloseTo(10.7769, 4);
    expect(decoded[0].longitude).toBeCloseTo(106.7009, 4);
    expect(decoded[2].latitude).toBeCloseTo(10.8, 4);
    expect(decoded[2].longitude).toBeCloseTo(106.72, 4);
  });
});
