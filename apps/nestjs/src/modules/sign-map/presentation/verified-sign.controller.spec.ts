import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { VerifiedSignController } from './verified-sign.controller';

describe('VerifiedSignController authorization', () => {
  it('keeps map reads public but protects create and update for staff and admins', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, VerifiedSignController)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, VerifiedSignController.prototype.findAlongRoute),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, VerifiedSignController.prototype.findInBounds),
    ).toBe(true);
    expect(Reflect.getMetadata(ROLES_KEY, VerifiedSignController.prototype.create)).toEqual([
      'STAFF',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, VerifiedSignController.prototype.update)).toEqual([
      'STAFF',
      'ADMIN',
    ]);
  });
});
