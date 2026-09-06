import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { CatalogService } from './catalog.service';
import { SignCategory } from './sign-category.entity';
import { SignTypeAiPrompt } from './sign-type-ai-prompt.entity';
import { SignTypeImage } from './sign-type-image.entity';
import { SignTypeOsmMapping } from './sign-type-osm-mapping.entity';
import { SystemParameter } from './system-parameter.entity';
import { TrafficSignType } from './traffic-sign-type.entity';

describe('CatalogService', () => {
  const categories = repository<SignCategory>();
  const signTypes = repository<TrafficSignType>();
  const parameters = repository<SystemParameter>();
  const aiPrompts = repository<SignTypeAiPrompt>();
  const osmMappings = repository<SignTypeOsmMapping>();
  const images = repository<SignTypeImage>();
  const dataSource = { transaction: jest.fn() } as unknown as DataSource;
  const service = new CatalogService(
    categories,
    signTypes,
    parameters,
    aiPrompts,
    osmMappings,
    images,
    dataSource,
  );

  beforeEach(() => jest.resetAllMocks());

  it('returns a zero-based page enriched with the Spring catalog fields', async () => {
    const type = trafficSignType();
    const query = queryBuilder([type], 23);
    signTypes.createQueryBuilder.mockReturnValue(query);
    aiPrompts.find.mockResolvedValue([
      entity<SignTypeAiPrompt>({
        signTypeId: type.id,
        promptText: 'red octagonal stop sign',
        version: 2,
        isActive: true,
      }),
    ]);
    osmMappings.find.mockResolvedValue([
      entity<SignTypeOsmMapping>({
        signTypeId: type.id,
        osmKey: 'traffic_sign',
        osmValue: 'stop',
      }),
      entity<SignTypeOsmMapping>({
        signTypeId: type.id,
        osmKey: 'highway',
        osmValue: 'stop',
      }),
    ]);
    images.find.mockResolvedValue([
      entity<SignTypeImage>({
        signTypeId: type.id,
        imageUrl: 'catalog/stop.png',
        imageType: 'REPRESENTATIVE',
        isPrimary: true,
      }),
    ]);

    const result = await service.listSignTypes({
      categoryId: 2,
      search: 'stop',
      page: 1,
      size: 10,
    });

    expect(query.where).toHaveBeenCalledWith('signType.isActive = :isActive', {
      isActive: true,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'signType.categoryId = :categoryId',
      { categoryId: 2 },
    );
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      content: [
        expect.objectContaining({
          id: type.id,
          aiLabelPrompt: 'red octagonal stop sign',
          osmMapping: 'traffic_sign=stop;highway=stop',
          representativeImageKey: 'catalog/stop.png',
        }),
      ],
      page: 1,
      size: 10,
      totalElements: 23,
      totalPages: 3,
    });
  });

  it('creates a sign type and its extra fields in one transaction', async () => {
    const category = entity<SignCategory>({ id: 2, code: 'REGULATORY' });
    const typeRepository = repository<TrafficSignType>();
    const categoryRepository = repository<SignCategory>();
    const promptRepository = repository<SignTypeAiPrompt>();
    const mappingRepository = repository<SignTypeOsmMapping>();
    const imageRepository = repository<SignTypeImage>();
    const manager = {
      getRepository: jest.fn((target) => {
        if (target === SignCategory) return categoryRepository;
        if (target === TrafficSignType) return typeRepository;
        if (target === SignTypeAiPrompt) return promptRepository;
        if (target === SignTypeOsmMapping) return mappingRepository;
        if (target === SignTypeImage) return imageRepository;
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;

    categoryRepository.findOne.mockResolvedValue(category);
    typeRepository.findOne.mockResolvedValue(null);
    typeRepository.create.mockImplementation((value) => value as TrafficSignType);
    typeRepository.save.mockImplementation(async (value) => ({
      ...(value as TrafficSignType),
      id: 12,
    }));
    promptRepository.findOne.mockResolvedValue(null);
    promptRepository.create.mockImplementation((value) => value as SignTypeAiPrompt);
    promptRepository.find.mockResolvedValue([
      entity<SignTypeAiPrompt>({
        signTypeId: 12,
        promptText: 'stop prompt',
        version: 1,
        isActive: true,
      }),
    ]);
    mappingRepository.create.mockImplementation((value) => value as SignTypeOsmMapping);
    mappingRepository.find.mockResolvedValue([
      entity<SignTypeOsmMapping>({
        signTypeId: 12,
        osmKey: 'traffic_sign',
        osmValue: 'stop',
      }),
    ]);
    imageRepository.create.mockImplementation((value) => value as SignTypeImage);
    imageRepository.find.mockResolvedValue([
      entity<SignTypeImage>({
        signTypeId: 12,
        imageUrl: 'catalog/stop.png',
        imageType: 'REPRESENTATIVE',
        isPrimary: true,
      }),
    ]);
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    const created = await service.createSignType({
      categoryId: 2,
      signCode: ' p.101 ',
      nameVi: ' Dung lai ',
      nameEn: ' Stop ',
      aiLabelPrompt: ' stop prompt ',
      osmMapping: 'traffic_sign=stop',
      representativeImageKey: 'catalog/stop.png',
    });

    expect(typeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ signCode: 'P.101', nameVi: 'Dung lai', nameEn: 'Stop' }),
    );
    expect(promptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ promptText: 'stop prompt', version: 1, isActive: true }),
    );
    expect(mappingRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ osmKey: 'traffic_sign', osmValue: 'stop' }),
    ]);
    expect(imageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'catalog/stop.png', isPrimary: true }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        id: 12,
        aiLabelPrompt: 'stop prompt',
        osmMapping: 'traffic_sign=stop',
        representativeImageKey: 'catalog/stop.png',
      }),
    );
  });

  it('rejects malformed OSM mappings before replacing stored mappings', async () => {
    const typeRepository = repository<TrafficSignType>();
    const mappingRepository = repository<SignTypeOsmMapping>();
    const manager = {
      getRepository: jest.fn((target) => {
        if (target === TrafficSignType) return typeRepository;
        if (target === SignTypeOsmMapping) return mappingRepository;
        if (target === SignTypeAiPrompt) return repository<SignTypeAiPrompt>();
        if (target === SignTypeImage) return repository<SignTypeImage>();
        if (target === SignCategory) return repository<SignCategory>();
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    const type = trafficSignType();
    typeRepository.findOne.mockResolvedValue(type);
    typeRepository.save.mockResolvedValue(type);
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    await expect(service.updateSignType(type.id, { osmMapping: 'invalid' })).rejects.toThrow(
      'OSM mapping must use key=value entries separated by semicolons',
    );
    expect(mappingRepository.delete).not.toHaveBeenCalled();
  });

  function trafficSignType(): TrafficSignType {
    return entity<TrafficSignType>({
      id: 12,
      categoryId: 2,
      signCode: 'P.101',
      nameVi: 'Dung lai',
      nameEn: 'Stop',
      description: null,
      labelingGuidelines: null,
      shape: 'OCTAGON',
      colorScheme: 'RED_WHITE',
      isActive: true,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      category: entity<SignCategory>({ id: 2, code: 'REGULATORY' }),
    });
  }

  function queryBuilder(
    content: TrafficSignType[],
    total: number,
  ): jest.Mocked<SelectQueryBuilder<TrafficSignType>> {
    const query = {
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      andWhere: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([content, total]),
    };
    for (const method of [
      'leftJoinAndSelect',
      'where',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
      'andWhere',
    ] as const) {
      query[method].mockReturnValue(query);
    }
    return query as unknown as jest.Mocked<SelectQueryBuilder<TrafficSignType>>;
  }

  function repository<T>(): jest.Mocked<Repository<T>> {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<T>>;
  }

  function entity<T>(value: Partial<T>): T {
    return value as T;
  }
});
