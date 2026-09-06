import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { SignGeolocationController } from './sign-geolocation.controller';

describe('SignGeolocationController authorization', () => {
  it('exposes the calculation endpoint without authentication', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SignGeolocationController)).toBe(true);
  });
});
