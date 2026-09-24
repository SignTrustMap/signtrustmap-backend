import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { RouteSignQueryService } from '../application/route-sign-query.service';
import { VerifiedSignService } from '../application/verified-sign.service';
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
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, VerifiedSignController.prototype.findNearbyCandidates),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, VerifiedSignController.prototype.confirm),
    ).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, VerifiedSignController.prototype.create)).toEqual([
      'STAFF',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, VerifiedSignController.prototype.update)).toEqual([
      'STAFF',
      'ADMIN',
    ]);
  });

  it('delegates findNearbyCandidates to VerifiedSignService', async () => {
    const routeSigns = {} as RouteSignQueryService;
    const verifiedSigns = {
      findNearbyCandidates: jest.fn().mockResolvedValue({ candidates: [], count: 0 }),
    } as unknown as VerifiedSignService;

    const controller = new VerifiedSignController(routeSigns, verifiedSigns);
    await controller.findNearbyCandidates({ latitude: 10.77, longitude: 106.69, radiusMeters: 25, headingDegrees: 90 });

    expect(verifiedSigns.findNearbyCandidates).toHaveBeenCalledWith(10.77, 106.69, 25, 90);
  });

  it('delegates confirm to VerifiedSignService.confirmSign', async () => {
    const routeSigns = {} as RouteSignQueryService;
    const verifiedSigns = {
      confirmSign: jest.fn().mockResolvedValue({ success: true, creditsAwarded: 10 }),
    } as unknown as VerifiedSignService;

    const controller = new VerifiedSignController(routeSigns, verifiedSigns);
    await controller.confirm(
      { id: 'user-1' },
      'sign-123',
      { isPresent: true, latitude: 10.77, longitude: 106.69 },
    );

    expect(verifiedSigns.confirmSign).toHaveBeenCalledWith(
      'user-1',
      'sign-123',
      { isPresent: true, latitude: 10.77, longitude: 106.69 },
    );
  });
});
