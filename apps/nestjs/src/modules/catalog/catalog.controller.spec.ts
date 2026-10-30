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

  it('maps Spring pagination and existing filter aliases', () => {
    controller.listSignTypes({
      categoryId: 2,
      isActive: 'false',
      q: 'stop',
      page: 2,
      pageSize: 25,
    });

    expect(service.listSignTypes).toHaveBeenCalledWith({
      categoryId: 2,
      isActive: false,
      search: 'stop',
      page: 2,
      size: 25,
    });
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
