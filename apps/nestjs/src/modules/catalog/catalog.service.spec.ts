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
      signCode: ' p. 101A ',
      nameVi: ' Dung lai ',
      nameEn: ' Stop ',
      aiLabelPrompt: ' stop prompt ',
      osmMapping: 'traffic_sign=stop',
      representativeImageKey: 'catalog/stop.png',
    });

    expect(typeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ signCode: 'P.101a', nameVi: 'Dung lai', nameEn: 'Stop' }),
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

  it('allows creating special test sign code T.xxx', async () => {
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
        return repository<any>();
      }),
    } as unknown as EntityManager;
    categoryRepository.findOne.mockResolvedValue(entity<SignCategory>({ id: 2 }));
    typeRepository.findOne.mockResolvedValue(null);
    typeRepository.create.mockImplementation((value) => value as TrafficSignType);
    typeRepository.save.mockImplementation(async (value) => ({
      ...(value as TrafficSignType),
      id: 99,
    }));
    typeRepository.find.mockResolvedValue([]);
    promptRepository.find.mockResolvedValue([]);
    mappingRepository.find.mockResolvedValue([]);
    imageRepository.find.mockResolvedValue([]);
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    const created = await service.createSignType({
      categoryId: 2,
      signCode: ' t.xxx ',
      nameVi: 'Biển test T.xxx',
      nameEn: 'Test Sign T.xxx',
      representativeImageKey: 'catalog/test.png',
    });

    expect(typeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ signCode: 'T.xxx', nameVi: 'Biển test T.xxx' }),
    );
    expect(created).toEqual(expect.objectContaining({ id: 99 }));
  });

  it('rejects a sign code that is not abbreviation.number with an optional alphanumeric suffix', async () => {
    const typeRepository = repository<TrafficSignType>();
    const categoryRepository = repository<SignCategory>();
    const manager = {
      getRepository: jest.fn((target) => {
        if (target === SignCategory) return categoryRepository;
        if (target === TrafficSignType) return typeRepository;
        return repository<any>();
      }),
    } as unknown as EntityManager;
    categoryRepository.findOne.mockResolvedValue(entity<SignCategory>({ id: 2 }));
    typeRepository.create.mockImplementation((value) => value as TrafficSignType);
    typeRepository.save.mockImplementation(async (value) => ({
      ...(value as TrafficSignType),
      id: 12,
    }));
    typeRepository.find.mockResolvedValue([]);
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    await expect(service.createSignType({
      categoryId: 2,
      signCode: 'P.127-40',
      nameVi: 'Tốc độ',
      nameEn: 'Speed',
      representativeImageKey: 'existing-image.png',
    })).rejects.toThrow('sign_code must match');
    expect(typeRepository.findOne).not.toHaveBeenCalled();
  });

  it('maps a database unique violation to a conflict during concurrent sign creation', async () => {
    const typeRepository = repository<TrafficSignType>();
    const categoryRepository = repository<SignCategory>();
    const manager = {
      getRepository: jest.fn((target) => {
        if (target === SignCategory) return categoryRepository;
        if (target === TrafficSignType) return typeRepository;
        return repository<any>();
      }),
    } as unknown as EntityManager;
    categoryRepository.findOne.mockResolvedValue(entity<SignCategory>({ id: 2 }));
    typeRepository.findOne.mockResolvedValue(null);
    typeRepository.create.mockImplementation((value) => value as TrafficSignType);
    typeRepository.save.mockRejectedValue(Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'UQ_traffic_sign_types_sign_code',
    }));
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    await expect(service.createSignType({
      categoryId: 2,
      signCode: 'P.999',
      nameVi: 'Tốc độ',
      nameEn: 'Speed',
      representativeImageKey: 'existing-image.png',
    })).rejects.toThrow('sign_code "P.999" exists');
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

  it('rejects creation when representative image is missing or empty', async () => {
    await expect(
      service.createSignType({
        categoryId: 2,
        signCode: 'P.102',
        nameVi: 'Cam vao',
        nameEn: 'No Entry',
        representativeImageKey: '   ',
      }),
    ).rejects.toThrow('Representative image is required for traffic sign types');

    await expect(
      service.createSignType({
        categoryId: 2,
        signCode: 'P.102',
        nameVi: 'Cam vao',
        nameEn: 'No Entry',
        representativeImageKey: undefined as any,
      }),
    ).rejects.toThrow('Representative image is required for traffic sign types');
  });

  it('rejects updating representative image to empty or whitespace', async () => {
    await expect(
      service.updateSignType(12, {
        representativeImageKey: '   ',
      }),
    ).rejects.toThrow('Representative image cannot be null or empty');
  });

  it('allows updating representative image to a valid non-empty URL', async () => {
    const typeRepository = repository<TrafficSignType>();
    const imageRepository = repository<SignTypeImage>();
    const promptRepository = repository<SignTypeAiPrompt>();
    const mappingRepository = repository<SignTypeOsmMapping>();
    const manager = {
      getRepository: jest.fn((target) => {
        if (target === TrafficSignType) return typeRepository;
        if (target === SignTypeImage) return imageRepository;
        if (target === SignCategory) return repository<SignCategory>();
        if (target === SignTypeAiPrompt) return promptRepository;
        if (target === SignTypeOsmMapping) return mappingRepository;
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;
    const type = trafficSignType();
    typeRepository.findOne.mockResolvedValue(type);
    typeRepository.save.mockResolvedValue(type);
    promptRepository.find.mockResolvedValue([]);
    mappingRepository.find.mockResolvedValue([]);
    imageRepository.create.mockImplementation((value) => value as SignTypeImage);
    imageRepository.find.mockResolvedValue([
      entity<SignTypeImage>({
        signTypeId: type.id,
        imageUrl: 'https://s3.signmap.site/stm-sign-crops/representative/new.png',
        imageType: 'REPRESENTATIVE',
        isPrimary: true,
      }),
    ]);
    (dataSource.transaction as jest.Mock).mockImplementation(
      (callback: (transactionManager: EntityManager) => unknown) => callback(manager),
    );

    const updated = await service.updateSignType(type.id, {
      representativeImageKey: 'https://s3.signmap.site/stm-sign-crops/representative/new.png',
    });

    expect(imageRepository.update).toHaveBeenCalledWith(
      { signTypeId: type.id, imageType: 'REPRESENTATIVE', isPrimary: true },
      { isPrimary: false },
    );
    expect(imageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        signTypeId: type.id,
        imageUrl: 'https://s3.signmap.site/stm-sign-crops/representative/new.png',
        imageType: 'REPRESENTATIVE',
        isPrimary: true,
      }),
    );
    expect(updated.representativeImageKey).toBe(
      'https://s3.signmap.site/stm-sign-crops/representative/new.png',
    );
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

  describe('Support Shots & Active Learning', () => {
    it('listSupportShots throws NotFoundException if signType not found', async () => {
      signTypes.findOne.mockResolvedValueOnce(null);
      await expect(service.listSupportShots(999)).rejects.toThrow();
    });

    it('listSupportShots returns ordered shots list', async () => {
      signTypes.findOne.mockResolvedValueOnce(entity<TrafficSignType>({ id: 1, signCode: 'P.101', nameVi: 'Cam' }));
      images.find.mockResolvedValueOnce([
        entity<SignTypeImage>({
          id: 'img-1',
          imageUrl: 's3/img1.jpg',
          imageType: 'REAL_PHOTO',
          role: 'MEDOID',
          isPrimary: true,
          isPinned: true,
          sharpness: 95.0,
          uploadedAt: new Date(),
        }),
      ]);

      const res = await service.listSupportShots(1);
      expect(res.signTypeId).toBe(1);
      expect(res.totalShots).toBe(1);
      expect(res.shots[0].id).toBe('img-1');
      expect(res.shots[0].isPinned).toBe(true);
    });

    it('addSupportShot unsets previous primary if isPrimary is true', async () => {
      signTypes.findOne.mockResolvedValueOnce(entity<TrafficSignType>({ id: 1 }));
      images.create.mockReturnValue(entity<SignTypeImage>({ id: 'img-2', imageUrl: 's3/img2.jpg', isPrimary: true }));
      images.save.mockResolvedValue(entity<SignTypeImage>({ id: 'img-2', imageUrl: 's3/img2.jpg', isPrimary: true }));

      const res = await service.addSupportShot(1, { imageUrl: 's3/img2.jpg', isPrimary: true });
      expect(images.update).toHaveBeenCalledWith({ signTypeId: 1 }, { isPrimary: false });
      expect(res.id).toBe('img-2');
    });

    it('deleteSupportShot checks existence and removes shot', async () => {
      images.findOne.mockResolvedValueOnce(null);
      await expect(service.deleteSupportShot(1, 'img-missing')).rejects.toThrow();

      const shot = entity<SignTypeImage>({ id: 'img-1', signTypeId: 1 });
      images.findOne.mockResolvedValueOnce(shot);
      images.remove.mockResolvedValueOnce(shot);

      const res = await service.deleteSupportShot(1, 'img-1');
      expect(res).toEqual({ deleted: true, imageId: 'img-1', signTypeId: 1 });
      expect(images.remove).toHaveBeenCalledWith(shot);
    });

    it('setSupportShotPinned updates pin status', async () => {
      images.findOne.mockResolvedValueOnce(null);
      await expect(service.setSupportShotPinned(1, 'img-missing', true)).rejects.toThrow();

      const shot = entity<SignTypeImage>({ id: 'img-1', signTypeId: 1, isPinned: false });
      images.findOne.mockResolvedValueOnce(shot);
      images.save.mockImplementation(async (s: any) => s);

      const res = await service.setSupportShotPinned(1, 'img-1', true);
      expect(res).toEqual({ updated: true, imageId: 'img-1', isPinned: true });
    });

    it('triggerPrototypeRebuild throws if catalogSyncService is missing', async () => {
      await expect(service.triggerPrototypeRebuild()).rejects.toThrow();
    });
  });

  describe('Representative image upload', () => {
    it('rejects an unsupported MIME type before touching storage', async () => {
      const storage = {
        putObject: jest.fn(),
        removeObject: jest.fn(),
      } as any;
      const uploadService = new CatalogService(
        categories,
        signTypes,
        parameters,
        aiPrompts,
        osmMappings,
        images,
        dataSource,
        undefined,
        storage,
      );
      signTypes.findOne.mockResolvedValue(entity<TrafficSignType>({ id: 12 }));

      await expect(uploadService.uploadRepresentativeImage(12, {
        buffer: Buffer.from('not-an-image'),
        size: 12,
        mimetype: 'application/pdf',
      } as Express.Multer.File)).rejects.toThrow('must be JPEG');
      expect(storage.putObject).not.toHaveBeenCalled();
    });

    it('removes only the newly uploaded object when database persistence fails', async () => {
      const storage = {
        putObject: jest.fn().mockResolvedValue(undefined),
        removeObject: jest.fn().mockResolvedValue(undefined),
        getPublicUrl: jest.fn().mockReturnValue('https://s3.test/new.jpg'),
      } as any;
      const uploadDataSource = { transaction: jest.fn().mockRejectedValue(new Error('db down')) } as any;
      const uploadService = new CatalogService(
        categories,
        signTypes,
        parameters,
        aiPrompts,
        osmMappings,
        images,
        uploadDataSource,
        undefined,
        storage,
      );
      signTypes.findOne.mockResolvedValue(entity<TrafficSignType>({ id: 12 }));
      const file = {
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        size: 4,
        mimetype: 'image/jpeg',
      } as Express.Multer.File;

      await expect(uploadService.uploadRepresentativeImage(12, file)).rejects.toThrow('db down');
      expect(storage.putObject).toHaveBeenCalledTimes(1);
      expect(storage.removeObject).toHaveBeenCalledTimes(1);
      expect(storage.removeObject.mock.calls[0][0].bucket).toBe('stm-sign-crops');
    });
  });

  function repository<T>(): jest.Mocked<Repository<T>> {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<T>>;
  }

  function entity<T>(value: Partial<T>): T {
    return value as T;
  }
});
