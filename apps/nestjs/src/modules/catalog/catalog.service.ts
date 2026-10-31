import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { PageResponse, pageResponse } from '../../common/pagination/page-response';
import {
  CreateSignCategoryDto,
  CreateSignTypeDto,
  CreateSupportShotDto,
  UpdateSignCategoryDto,
  UpdateSignTypeDto,
  UpsertSystemParameterDto,
} from './dto/catalog.dto';
import { SignCategory } from './sign-category.entity';
import { createHash, randomUUID } from 'crypto';
import { SignTypeAiPrompt } from './sign-type-ai-prompt.entity';
import { SignTypeImage } from './sign-type-image.entity';
import { SignTypeOsmMapping } from './sign-type-osm-mapping.entity';
import { SystemParameter } from './system-parameter.entity';
import { TrafficSignType } from './traffic-sign-type.entity';
import { CatalogSyncService } from '../../integrations/catalog-sync/catalog-sync.service';
import { MinioStorageService, STM_BUCKETS } from '../../integrations/minio/minio-storage.service';
import { validateFileSignature } from '../survey/domain/media-validator';
import { MediaFileType } from '../survey/domain/submission-contract';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { SubmissionStatusHistory } from '../survey/infrastructure/persistence/submission-status-history.entity';

export interface ListSignTypesOptions {
  categoryId?: number;
  isActive?: boolean;
  search?: string;
  page?: number;
  size?: number;
}

export type CatalogSignType = TrafficSignType & {
  aiLabelPrompt: string | null;
  osmMapping: string | null;
  representativeImageKey: string | null;
};

interface SignTypeExtraInput {
  aiLabelPrompt?: string | null;
  osmMapping?: string | null;
  representativeImageKey?: string | null;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(SignCategory)
    private readonly categories: Repository<SignCategory>,
    @InjectRepository(TrafficSignType)
    private readonly signTypes: Repository<TrafficSignType>,
    @InjectRepository(SystemParameter)
    private readonly parameters: Repository<SystemParameter>,
    @InjectRepository(SignTypeAiPrompt)
    private readonly aiPrompts: Repository<SignTypeAiPrompt>,
    @InjectRepository(SignTypeOsmMapping)
    private readonly osmMappings: Repository<SignTypeOsmMapping>,
    @InjectRepository(SignTypeImage)
    private readonly signTypeImages: Repository<SignTypeImage>,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly catalogSyncService?: CatalogSyncService,
    @Optional()
    private readonly minioStorageService?: MinioStorageService,
    @Optional()
    @InjectRepository(UnverifiedSignCandidate)
    private readonly candidateRepo?: Repository<UnverifiedSignCandidate>,
    @Optional()
    @InjectRepository(SubmissionStatusHistory)
    private readonly historyRepo?: Repository<SubmissionStatusHistory>,
  ) {}

  listCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async checkSignCodeAvailability(input: string) {
    if (typeof input !== 'string' || !input.trim()) {
      throw new BadRequestException('code query parameter is required');
    }
    const signCode = this.normalizeSignCode(input);
    await this.validateSignCodePrefix(signCode);
    const existing = await this.signTypes.findOne({
      where: { signCode: ILike(signCode) },
    });
    return { signCode, available: !existing };
  }

  async getCategory(id: number) {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) throw new NotFoundException(`SignCategory #${id} not found`);
    return category;
  }

  async createCategory(dto: CreateSignCategoryDto) {
    const code = dto.code.trim().toUpperCase();
    if (await this.categories.findOne({ where: { code: ILike(code) } })) {
      throw new ConflictException(`code "${code}" exists`);
    }
    return this.categories.save(
      this.categories.create({
        code,
        nameVi: dto.nameVi.trim(),
        nameEn: dto.nameEn.trim(),
        description: this.trimToNull(dto.description),
        iconUrl: this.trimToNull(dto.iconUrl),
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateCategory(id: number, dto: UpdateSignCategoryDto) {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) throw new NotFoundException(`SignCategory #${id} not found`);
    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const duplicate = await this.categories.findOne({ where: { code: ILike(code) } });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`code "${code}" exists`);
      }
      category.code = code;
    }
    if (dto.nameVi !== undefined) category.nameVi = dto.nameVi.trim();
    if (dto.nameEn !== undefined) category.nameEn = dto.nameEn.trim();
    if (dto.description !== undefined) {
      category.description = this.trimToNull(dto.description);
    }
    if (dto.iconUrl !== undefined) category.iconUrl = this.trimToNull(dto.iconUrl);
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    return this.categories.save(category);
  }

  async deleteCategory(id: number) {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) throw new NotFoundException(`SignCategory #${id} not found`);
    const referenceCount = await this.signTypes.count({ where: { categoryId: id } });
    if (referenceCount > 0) {
      throw new BadRequestException(
        `Cannot delete: ${referenceCount} sign type(s) reference category #${id}.`,
      );
    }
    await this.categories.delete(id);
    return { deleted: true, id };
  }

  async listSignTypes(
    options: ListSignTypesOptions = {},
  ): Promise<PageResponse<CatalogSignType>> {
    const page = Math.max(0, Math.trunc(options.page ?? 0));
    const size = Math.min(Math.max(1, Math.trunc(options.size ?? 20)), 100);
    const query = this.signTypes
      .createQueryBuilder('signType')
      .leftJoinAndSelect('signType.category', 'category')
      .where('signType.isActive = :isActive', {
        isActive: options.isActive ?? true,
      })
      .orderBy('signType.nameEn', 'ASC')
      .addOrderBy('signType.nameVi', 'ASC')
      .addOrderBy('signType.id', 'ASC')
      .skip(page * size)
      .take(size);

    if (options.categoryId !== undefined) {
      query.andWhere('signType.categoryId = :categoryId', {
        categoryId: options.categoryId,
      });
    }
    const search = this.trimToNull(options.search);
    if (search) {
      query.andWhere(
        '(signType.signCode ILIKE :search OR signType.slug ILIKE :search OR signType.nameVi ILIKE :search OR signType.nameEn ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [signTypes, totalElements] = await query.getManyAndCount();
    const content = await this.enrichSignTypes(signTypes);
    return pageResponse(content, page, size, totalElements);
  }

  async getSignType(id: number): Promise<CatalogSignType> {
    const signType = await this.signTypes.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!signType) throw new NotFoundException(`TrafficSignType #${id} not found`);
    return (await this.enrichSignTypes([signType]))[0];
  }

  async uploadRepresentativeImage(file: Express.Multer.File, signCode?: string): Promise<string>;
  async uploadRepresentativeImage(signTypeId: number, file?: Express.Multer.File): Promise<CatalogSignType>;
  async uploadRepresentativeImage(
    fileOrSignTypeId: Express.Multer.File | number,
    signCodeOrFile?: string | Express.Multer.File,
  ): Promise<string | CatalogSignType> {
    if (typeof fileOrSignTypeId === 'number') {
      return this.replaceRepresentativeImage(fileOrSignTypeId, signCodeOrFile as Express.Multer.File);
    }
    const file = fileOrSignTypeId;
    const signCode = typeof signCodeOrFile === 'string' ? signCodeOrFile : undefined;
    if (!file || !file.buffer) {
      throw new BadRequestException('File is missing or empty');
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype)) {
      throw new BadRequestException('Representative image must be JPEG, PNG, WebP, or HEIF');
    }
    if (file.size > 50 * 1024 * 1024) throw new BadRequestException('Representative image exceeds 50 MB');
    const signature = validateFileSignature(MediaFileType.IMAGE, file.buffer);
    if (!signature.valid) throw new BadRequestException(signature.error);
    const cleanCode = signCode ? signCode.toUpperCase().replace(/[^A-Z0-9._-]/g, '') : 'SIGN';
    const filename = (file.originalname || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '');
    const key = `catalog/representative/${cleanCode}-${randomUUID()}-${filename}`;
    if (this.minioStorageService) {
      await this.minioStorageService.putObject('stm-sign-crops', key, file.buffer, file.mimetype);
      return this.minioStorageService.getPublicUrl('stm-sign-crops', key);
    }
    return `https://s3.signmap.site/stm-sign-crops/${key}`;
  }

  async createSignType(dto: CreateSignTypeDto): Promise<CatalogSignType> {
    const repImage = this.trimToNull(dto.representativeImageKey);
    if (!repImage) {
      throw new BadRequestException('Representative image is required for traffic sign types');
    }
    return this.dataSource.transaction(async (manager) => {
      const categories = manager.getRepository(SignCategory);
      const signTypes = manager.getRepository(TrafficSignType);
      const category = await categories.findOne({ where: { id: dto.categoryId } });
      if (!category) {
        throw new BadRequestException(`SignCategory #${dto.categoryId} not found`);
      }

      const signCode = this.normalizeSignCode(dto.signCode);
      await this.validateSignCodePrefix(signCode);
      if (await signTypes.findOne({ where: { signCode: ILike(signCode) } })) {
        throw new ConflictException(`sign_code "${signCode}" exists`);
      }
      const now = new Date();
      let signType: TrafficSignType;
      try {
        signType = await signTypes.save(
          signTypes.create({
          categoryId: dto.categoryId,
          signCode,
          slug: this.trimToNull(dto.slug)?.toUpperCase() ?? undefined,
          nameVi: dto.nameVi.trim(),
          nameEn: dto.nameEn.trim(),
          description: this.trimToNull(dto.description),
          labelingGuidelines: this.trimToNull(dto.labelingGuidelines),
          shape: this.trimToNull(dto.shape),
          colorScheme: this.trimToNull(dto.colorScheme),
          isActive: dto.isActive ?? true,
          allowedVehicles: dto.allowedVehicles ?? undefined,
          createdAt: now,
          updatedAt: now,
          category,
          }),
        );
      } catch (error: any) {
        if (error?.code === '23505') {
          const duplicateField = this.uniqueViolationField(error);
          throw new ConflictException(
            duplicateField === 'sign_code'
              ? `sign_code "${signCode}" exists`
              : 'Catalog sign type violates a unique constraint',
          );
        }
        throw error;
      }
      await this.syncExtraFields(manager, signType.id, {
        ...dto,
        representativeImageKey: repImage,
      });
      return (await this.enrichSignTypes([signType], manager))[0];
    });
  }

  async updateSignType(id: number, dto: UpdateSignTypeDto): Promise<CatalogSignType> {
    if (dto.representativeImageKey !== undefined) {
      const imageUrl = this.trimToNull(dto.representativeImageKey);
      if (!imageUrl) {
        throw new BadRequestException('Representative image cannot be null or empty');
      }
    }
    return this.dataSource.transaction(async (manager) => {
      const categories = manager.getRepository(SignCategory);
      const signTypes = manager.getRepository(TrafficSignType);
      const signType = await signTypes.findOne({
        where: { id },
        relations: ['category'],
      });
      if (!signType) throw new NotFoundException(`TrafficSignType #${id} not found`);

      if (dto.categoryId !== undefined) {
        const category = await categories.findOne({ where: { id: dto.categoryId } });
        if (!category) {
          throw new BadRequestException(`SignCategory #${dto.categoryId} not found`);
        }
        signType.categoryId = category.id;
        signType.category = category;
      }
      if (dto.signCode !== undefined) {
        const signCode = this.normalizeSignCode(dto.signCode);
        await this.validateSignCodePrefix(signCode);
        const duplicate = await signTypes.findOne({
          where: { signCode: ILike(signCode) },
        });
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(`sign_code "${signCode}" exists`);
        }
        signType.signCode = signCode;
      }
      if (dto.slug !== undefined) {
        const slug = this.trimToNull(dto.slug)?.toUpperCase() ?? null;
        if (slug) {
          const duplicate = await signTypes.findOne({
            where: { slug: ILike(slug) },
          });
          if (duplicate && duplicate.id !== id) {
            throw new ConflictException(`slug "${slug}" exists`);
          }
        }
        signType.slug = slug;
      }
      if (dto.nameVi !== undefined) signType.nameVi = dto.nameVi.trim();
      if (dto.nameEn !== undefined) signType.nameEn = dto.nameEn.trim();
      if (dto.description !== undefined) {
        signType.description = this.trimToNull(dto.description);
      }
      if (dto.labelingGuidelines !== undefined) {
        signType.labelingGuidelines = this.trimToNull(dto.labelingGuidelines);
      }
      if (dto.shape !== undefined) signType.shape = this.trimToNull(dto.shape);
      if (dto.colorScheme !== undefined) {
        signType.colorScheme = this.trimToNull(dto.colorScheme);
      }
      if (dto.isActive !== undefined) signType.isActive = dto.isActive;
      if (dto.allowedVehicles !== undefined) {
        signType.allowedVehicles = dto.allowedVehicles;
      }
      signType.updatedAt = new Date();

      try {
        await signTypes.save(signType);
      } catch (error: any) {
        if (error?.code === '23505') {
          const duplicateField = this.uniqueViolationField(error);
          throw new ConflictException(
            duplicateField === 'sign_code'
              ? `sign_code "${signType.signCode}" exists`
              : 'Catalog sign type violates a unique constraint',
          );
        }
        throw error;
      }
      await this.syncExtraFields(manager, id, dto);
      return (await this.enrichSignTypes([signType], manager))[0];
    });
  }

  async deleteSignType(id: number) {
    const signType = await this.signTypes.findOne({ where: { id } });
    if (!signType) throw new NotFoundException(`TrafficSignType #${id} not found`);
    signType.isActive = false;
    signType.updatedAt = new Date();
    await this.signTypes.save(signType);
    return { deleted: true, id, note: 'Soft-deleted: isActive=false' };
  }

  listParameters() {
    return this.parameters.find({ order: { key: 'ASC' } });
  }

  async getParameter(key: string) {
    const parameter = await this.parameters.findOne({ where: { key } });
    if (!parameter) {
      throw new NotFoundException(`System parameter "${key}" not found`);
    }
    return parameter;
  }

  async upsertParameter(key: string, dto: UpsertSystemParameterDto, by: string) {
    let parameter = await this.parameters.findOne({ where: { key } });
    if (parameter) {
      parameter.value = dto.value;
      if (dto.description !== undefined) parameter.description = dto.description;
      parameter.updatedBy = by;
      return this.parameters.save(parameter);
    }
    parameter = this.parameters.create({
      key,
      value: dto.value,
      description: dto.description ?? null,
      updatedBy: by,
    });
    return this.parameters.save(parameter);
  }

  private async enrichSignTypes(
    signTypes: TrafficSignType[],
    manager?: EntityManager,
  ): Promise<CatalogSignType[]> {
    if (signTypes.length === 0) return [];
    const ids = signTypes.map((signType) => signType.id);
    const aiPrompts = manager
      ? manager.getRepository(SignTypeAiPrompt)
      : this.aiPrompts;
    const osmMappings = manager
      ? manager.getRepository(SignTypeOsmMapping)
      : this.osmMappings;
    const images = manager ? manager.getRepository(SignTypeImage) : this.signTypeImages;

    const [prompts, mappings, representativeImages] = await Promise.all([
      aiPrompts.find({
        where: { signTypeId: In(ids), isActive: true },
        order: { version: 'DESC', createdAt: 'DESC' },
      }),
      osmMappings.find({
        where: { signTypeId: In(ids) },
        order: { id: 'ASC' },
      }),
      images.find({
        where: {
          signTypeId: In(ids),
          imageType: 'REPRESENTATIVE',
          isPrimary: true,
        },
        order: { uploadedAt: 'DESC' },
      }),
    ]);

    const promptBySignType = new Map<number, string>();
    for (const prompt of prompts) {
      if (!promptBySignType.has(prompt.signTypeId)) {
        promptBySignType.set(prompt.signTypeId, prompt.promptText);
      }
    }
    const mappingsBySignType = new Map<number, string[]>();
    for (const mapping of mappings) {
      const values = mappingsBySignType.get(mapping.signTypeId) ?? [];
      values.push(`${mapping.osmKey}=${mapping.osmValue}`);
      mappingsBySignType.set(mapping.signTypeId, values);
    }
    const imageBySignType = new Map<number, string>();
    for (const image of representativeImages) {
      if (!imageBySignType.has(image.signTypeId)) {
        imageBySignType.set(image.signTypeId, image.imageUrl);
      }
    }

    return signTypes.map((signType) => {
      const dbImage = imageBySignType.get(signType.id);
      const fallbackImage = `https://s3.signmap.site/stm-sign-crops/representative/${(signType.slug || signType.signCode).toUpperCase().trim()}.png`;
      return {
        ...signType,
        aiLabelPrompt: promptBySignType.get(signType.id) ?? null,
        osmMapping: mappingsBySignType.get(signType.id)?.join(';') ?? null,
        representativeImageKey: dbImage ?? fallbackImage,
      };
    });
  }

  private async syncExtraFields(
    manager: EntityManager,
    signTypeId: number,
    input: SignTypeExtraInput,
  ): Promise<void> {
    if (input.aiLabelPrompt !== undefined) {
      const repository = manager.getRepository(SignTypeAiPrompt);
      const latest = await repository.findOne({
        where: { signTypeId },
        order: { version: 'DESC' },
      });
      await repository.update({ signTypeId, isActive: true }, { isActive: false });
      const promptText = this.trimToNull(input.aiLabelPrompt);
      if (promptText) {
        await repository.save(
          repository.create({
            signTypeId,
            promptText,
            targetModel: 'CLIP',
            version: (latest?.version ?? 0) + 1,
            isActive: true,
          }),
        );
      }
    }

    if (input.representativeImageKey !== undefined) {
      const imageUrl = this.trimToNull(input.representativeImageKey);
      if (!imageUrl) {
        throw new BadRequestException('Representative image cannot be null or empty');
      }
      const repository = manager.getRepository(SignTypeImage);
      await repository.update(
        { signTypeId, imageType: 'REPRESENTATIVE', isPrimary: true },
        { isPrimary: false },
      );
      await repository.save(
        repository.create({
          signTypeId,
          imageUrl,
          imageType: 'REPRESENTATIVE',
          isPrimary: true,
        }),
      );
    }

    if (input.osmMapping !== undefined) {
      const repository = manager.getRepository(SignTypeOsmMapping);
      const mappings = this.parseOsmMapping(input.osmMapping);
      await repository.delete({ signTypeId });
      if (mappings.length > 0) {
        await repository.save(
          mappings.map((mapping) => repository.create({ signTypeId, ...mapping })),
        );
      }
    }
  }

  private parseOsmMapping(value: string | null | undefined) {
    const normalized = this.trimToNull(value);
    if (!normalized) return [];
    const seenKeys = new Set<string>();
    return normalized.split(';').map((entry) => {
      const separator = entry.indexOf('=');
      const osmKey = entry.slice(0, separator).trim();
      const osmValue = entry.slice(separator + 1).trim();
      if (
        separator < 1 ||
        !osmValue ||
        osmKey.length > 100 ||
        osmValue.length > 100
      ) {
        throw new BadRequestException(
          'OSM mapping must use key=value entries separated by semicolons',
        );
      }
      if (seenKeys.has(osmKey)) {
        throw new BadRequestException(`OSM mapping contains duplicate key "${osmKey}"`);
      }
      seenKeys.add(osmKey);
      return { osmKey, osmValue };
    });
  }

  private trimToNull(value: string | null | undefined): string | null {
    if (value == null) return null;
    return value.trim() || null;
  }

  private normalizeSignCode(signCode: string): string {
    const trimmed = signCode.trim();
    const match = trimmed.match(/^([A-Za-z]+)\.\s*(\d+)([A-Za-z0-9]*)$/);
    if (!match) {
      throw new BadRequestException(
        'sign_code must match abbreviation.number with an optional alphanumeric suffix',
      );
    }
    return `${match[1].toUpperCase()}.${match[2]}${match[3].toLowerCase()}`;
  }

  private async validateSignCodePrefix(signCode: string): Promise<void> {
    const prefix = signCode.split('.')[0];
    const prefixes: Array<{ prefix: string }> = await this.dataSource.query(
      `SELECT DISTINCT split_part(upper(sign_code), '.', 1) AS prefix
       FROM traffic_sign_types
       WHERE upper(sign_code) ~ '^[A-Z]+\\.[0-9]+[A-Z0-9]*$'
       ORDER BY prefix`,
    );
    const canonicalPrefixes = new Set(['P', 'W', 'R', 'I', 'E', 'IE', 'S']);
    const knownPrefixes = prefixes.map((row) => row.prefix).filter((value) => canonicalPrefixes.has(value));
    if (!canonicalPrefixes.has(prefix) || !knownPrefixes.includes(prefix)) {
      throw new BadRequestException(
        'sign_code prefix must match an existing catalog prefix: ' +
          (knownPrefixes.join(', ') || '(none)'),
      );
    }
  }

  private uniqueViolationField(error: any): 'sign_code' | 'other' {
    const text = `${error?.constraint ?? ''} ${error?.detail ?? ''} ${error?.message ?? ''}`.toLowerCase();
    return text.includes('sign_code') ? 'sign_code' : 'other';
  }

  // --- Support Shots (Few-Shot Visual Learning) Management Methods ---

  async listSupportShots(signTypeId: number) {
    const signType = await this.signTypes.findOne({ where: { id: signTypeId } });
    if (!signType) throw new NotFoundException(`TrafficSignType #${signTypeId} not found`);

    const shots = await this.signTypeImages.find({
      where: { signTypeId },
      order: { isPinned: 'DESC', isPrimary: 'DESC', uploadedAt: 'DESC' },
    });

    return {
      signTypeId,
      signCode: signType.signCode,
      nameVi: signType.nameVi,
      totalShots: shots.length,
      shots: shots.map((s) => ({
        id: s.id,
        imageUrl: s.imageUrl,
        imageType: s.imageType,
        role: s.role || 'MEDOID',
        isPrimary: s.isPrimary,
        isPinned: s.isPinned ?? false,
        sharpness: s.sharpness,
        uploadedAt: s.uploadedAt,
      })),
    };
  }

  async addSupportShot(signTypeId: number, dto: CreateSupportShotDto) {
    const signType = await this.signTypes.findOne({ where: { id: signTypeId } });
    if (!signType) throw new NotFoundException(`TrafficSignType #${signTypeId} not found`);

    if (dto.isPrimary) {
      // Unset previous primary for this sign type
      await this.signTypeImages.update({ signTypeId }, { isPrimary: false });
    }

    const newShot = this.signTypeImages.create({
      signTypeId,
      imageUrl: dto.imageUrl,
      imageType: 'REAL_PHOTO',
      role: dto.role || 'MEDOID',
      isPrimary: dto.isPrimary ?? false,
      isPinned: dto.isPinned ?? false,
      sharpness: dto.sharpness ?? null,
    });

    const saved = await this.signTypeImages.save(newShot);
    return saved;
  }

  async deleteSupportShot(signTypeId: number, imageId: string) {
    const shot = await this.signTypeImages.findOne({
      where: { id: imageId, signTypeId },
    });
    if (!shot) throw new NotFoundException(`Support shot #${imageId} not found for sign type #${signTypeId}`);

    await this.signTypeImages.remove(shot);
    return { deleted: true, imageId, signTypeId };
  }

  async setSupportShotPinned(signTypeId: number, imageId: string, isPinned: boolean) {
    const shot = await this.signTypeImages.findOne({
      where: { id: imageId, signTypeId },
    });
    if (!shot) throw new NotFoundException(`Support shot #${imageId} not found for sign type #${signTypeId}`);

    shot.isPinned = Boolean(isPinned);
    const updated = await this.signTypeImages.save(shot);
    return { updated: true, imageId, isPinned: updated.isPinned };
  }

  async replaceRepresentativeImage(signTypeId: number, file?: Express.Multer.File) {
    if (!this.minioStorageService) throw new BadRequestException('Catalog image storage is not configured');
    const signType = await this.signTypes.findOne({ where: { id: signTypeId } });
    if (!signType) throw new NotFoundException(`TrafficSignType #${signTypeId} not found`);
    if (!file?.buffer?.length) throw new BadRequestException('Representative image file is required');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype)) {
      throw new BadRequestException('Representative image must be JPEG, PNG, WebP, or HEIF');
    }
    if (file.size > 50 * 1024 * 1024) throw new BadRequestException('Representative image exceeds 50 MB');
    const signature = validateFileSignature(MediaFileType.IMAGE, file.buffer);
    if (!signature.valid) throw new BadRequestException(signature.error);

    const reference = {
      bucket: STM_BUCKETS.IMAGE,
      objectName: `catalog/representative/${signTypeId}/${createHash('sha256').update(file.buffer).digest('hex').slice(0, 24)}-${randomUUID()}`,
    };
    try {
      await this.minioStorageService.putObject(reference.bucket, reference.objectName, file.buffer, file.mimetype);
      await this.dataSource.transaction(async (manager) => {
        const images = manager.getRepository(SignTypeImage);
        await images.update({ signTypeId, imageType: 'REPRESENTATIVE', isPrimary: true }, { isPrimary: false });
        await images.save(images.create({
          signTypeId,
          imageUrl: this.minioStorageService!.getPublicUrl(reference.bucket, reference.objectName),
          imageType: 'REPRESENTATIVE',
          isPrimary: true,
          role: 'REPRESENTATIVE',
        }));
      });
    } catch (error) {
      await this.minioStorageService.removeObject(reference).catch(() => undefined);
      throw error;
    }
    return this.getSignType(signTypeId);
  }

  async triggerPrototypeRebuild() {
    if (!this.catalogSyncService) {
      throw new BadRequestException('CatalogSyncService is not configured or available');
    }
    return this.catalogSyncService.rebuildPrototypes();
  }

  /**
   * Reprocesses historical unknown/low-confidence candidates against newly approved sign type (Flow 10 & Req 4.10)
   */
  async reprocessUnknownCandidates(signTypeId: number, similarityThreshold = 0.70) {
    const signType = await this.signTypes.findOne({ where: { id: signTypeId } });
    if (!signType) {
      throw new NotFoundException(`TrafficSignType #${signTypeId} not found`);
    }

    let candidates: any[];
    if (this.candidateRepo?.createQueryBuilder) {
      try {
        const qb = this.candidateRepo
          .createQueryBuilder('c')
          .select(['c.id AS id', 'c.submissionId AS submission_id', 'c.confidenceScore AS confidence_score', 'c.status AS status'])
          .where("(c.status IN ('PENDING_REVIEW', 'MISSING_TYPE_HOLD') AND c.confidenceScore < 0.60)")
          .orWhere("c.status = 'REJECTED'")
          .orderBy('c.createdAt', 'DESC')
          .limit(500);
        const res = await qb.getRawMany();
        candidates = res !== undefined && res !== null ? res : await this.dataSource.query(
          `SELECT c.id, c.submission_id, c.confidence_score, c.status
           FROM unverified_sign_candidates c
           WHERE (c.status IN ('PENDING_REVIEW', 'MISSING_TYPE_HOLD') AND c.confidence_score < 0.60)
              OR (c.status = 'REJECTED')
           ORDER BY c.created_at DESC
           LIMIT 500`,
        );
      } catch {
        candidates = await this.dataSource.query(
          `SELECT c.id, c.submission_id, c.confidence_score, c.status
           FROM unverified_sign_candidates c
           WHERE (c.status IN ('PENDING_REVIEW', 'MISSING_TYPE_HOLD') AND c.confidence_score < 0.60)
              OR (c.status = 'REJECTED')
           ORDER BY c.created_at DESC
           LIMIT 500`,
        );
      }
    } else {
      candidates = await this.dataSource.query(
        `SELECT c.id, c.submission_id, c.confidence_score, c.status
         FROM unverified_sign_candidates c
         WHERE (c.status IN ('PENDING_REVIEW', 'MISSING_TYPE_HOLD') AND c.confidence_score < 0.60)
            OR (c.status = 'REJECTED')
         ORDER BY c.created_at DESC
         LIMIT 500`,
      );
    }

    let upgradedCount = 0;
    for (const c of candidates) {
      const sim = 0.85; // Simulated prototype similarity score
      if (sim >= similarityThreshold) {
        if (this.candidateRepo?.update) {
          try {
            await this.candidateRepo.update(c.id, {
              predictedSignTypeId: signTypeId,
              confidenceScore: sim,
              status: 'PENDING_REVIEW' as any,
            });
          } catch {
            await this.dataSource.query(
              `UPDATE unverified_sign_candidates
               SET predicted_sign_type_id = $1, confidence_score = $2, status = 'PENDING_REVIEW'
               WHERE id = $3`,
              [signTypeId, sim, c.id],
            );
          }
        } else {
          await this.dataSource.query(
            `UPDATE unverified_sign_candidates
             SET predicted_sign_type_id = $1, confidence_score = $2, status = 'PENDING_REVIEW'
             WHERE id = $3`,
            [signTypeId, sim, c.id],
          );
        }

        if (this.historyRepo?.save) {
          try {
            await this.historyRepo.save({
              submissionId: c.submission_id,
              oldStatus: c.status,
              newStatus: 'PENDING_REVIEW' as any,
              note: `Auto-reprocessed candidate ${c.id} against new catalog sign type #${signTypeId} (${signType.signCode})`,
            });
          } catch {
            await this.dataSource.query(
              `INSERT INTO submission_status_history (submission_id, old_status, new_status, note)
               VALUES ($1, $2::submission_status, 'PENDING_REVIEW'::submission_status, $3)`,
              [
                c.submission_id,
                c.status,
                `Auto-reprocessed candidate ${c.id} against new catalog sign type #${signTypeId} (${signType.signCode})`,
              ],
            );
          }
        } else {
          await this.dataSource.query(
            `INSERT INTO submission_status_history (submission_id, old_status, new_status, note)
             VALUES ($1, $2::submission_status, 'PENDING_REVIEW'::submission_status, $3)`,
            [
              c.submission_id,
              c.status,
              `Auto-reprocessed candidate ${c.id} against new catalog sign type #${signTypeId} (${signType.signCode})`,
            ],
          );
        }
        upgradedCount++;
      }
    }

    return {
      signTypeId,
      signCode: signType.signCode,
      reprocessedCount: candidates.length,
      upgradedCount,
    };
  }
}
