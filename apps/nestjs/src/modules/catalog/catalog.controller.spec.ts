import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

describe('CatalogController', () => {
  const service = {
    listSignTypes: jest.fn(),
    checkSignCodeAvailability: jest.fn(),
    uploadRepresentativeImage: jest.fn(),
  } as unknown as CatalogService;
  const controller = new CatalogController(service);

  beforeEach(() => jest.resetAllMocks());

  it('checks sign code availability through the catalog service', () => {
    controller.checkSignCode('P.110');

    expect(service.checkSignCodeAvailability).toHaveBeenCalledWith('P.110');
  });

  it('maps Spring pagination and allows ADMIN to filter inactive signs', () => {
    controller.listSignTypes(
      {
        categoryId: 2,
        isActive: 'false',
        q: 'stop',
        page: 2,
        pageSize: 25,
      },
      { roles: ['ADMIN'] },
    );

    expect(service.listSignTypes).toHaveBeenCalledWith({
      categoryId: 2,
      isActive: false,
      search: 'stop',
      page: 2,
      size: 25,
    });
  });

  it('allows STAFF to view all signs when isActive filter is omitted', () => {
    controller.listSignTypes(
      {
        categoryId: 2,
        page: 0,
        pageSize: 10,
      },
      { roles: ['STAFF'] },
    );

    expect(service.listSignTypes).toHaveBeenCalledWith({
      categoryId: 2,
      isActive: undefined,
      search: undefined,
      page: 0,
      size: 10,
    });
  });

  it('restricts DRIVER, SURVEYOR, and REVIEWER to only active signs even if isActive=false requested', () => {
    for (const role of ['DRIVER', 'SURVEYOR', 'REVIEWER']) {
      jest.clearAllMocks();
      controller.listSignTypes(
        {
          categoryId: 2,
          isActive: 'false',
          q: 'speed',
        },
        { roles: [role] },
      );

      expect(service.listSignTypes).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: true,
        }),
      );
    }
  });

  it('defaults unauthenticated or general users to only active signs', () => {
    controller.listSignTypes({
      categoryId: 1,
      isActive: 'false',
    });

    expect(service.listSignTypes).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
      }),
    );
  });

  it('keeps catalog reads authenticated and writes ADMIN-only', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CatalogController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CatalogController.prototype.createSignType)).toEqual([
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CatalogController.prototype.updateSignType)).toEqual([
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CatalogController.prototype.uploadRepresentativeImage)).toEqual([
      'ADMIN',
    ]);
  });
});
