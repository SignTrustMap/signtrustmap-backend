import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { PageResponse, pageResponse } from '../../common/pagination/page-response';
import {
  CreateSignCategoryDto,
  CreateSignTypeDto,
  UpdateSignCategoryDto,
  UpdateSignTypeDto,
  UpsertSystemParameterDto,
} from './dto/catalog.dto';
import { SignCategory } from './sign-category.entity';
import { SignTypeAiPrompt } from './sign-type-ai-prompt.entity';
import { SignTypeImage } from './sign-type-image.entity';
import { SignTypeOsmMapping } from './sign-type-osm-mapping.entity';
import { SystemParameter } from './system-parameter.entity';
import { TrafficSignType } from './traffic-sign-type.entity';

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
  ) {}

  listCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
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
        '(signType.signCode ILIKE :search OR signType.nameVi ILIKE :search OR signType.nameEn ILIKE :search)',
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

  async createSignType(dto: CreateSignTypeDto): Promise<CatalogSignType> {
    return this.dataSource.transaction(async (manager) => {
      const categories = manager.getRepository(SignCategory);
      const signTypes = manager.getRepository(TrafficSignType);
      const category = await categories.findOne({ where: { id: dto.categoryId } });
      if (!category) {
        throw new BadRequestException(`SignCategory #${dto.categoryId} not found`);
      }

      const signCode = dto.signCode.trim().toUpperCase();
      if (await signTypes.findOne({ where: { signCode: ILike(signCode) } })) {
        throw new ConflictException(`sign_code "${signCode}" exists`);
      }
      const now = new Date();
      const signType = await signTypes.save(
        signTypes.create({
          categoryId: dto.categoryId,
          signCode,
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
      await this.syncExtraFields(manager, signType.id, dto);
      return (await this.enrichSignTypes([signType], manager))[0];
    });
  }

  async updateSignType(id: number, dto: UpdateSignTypeDto): Promise<CatalogSignType> {
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
        const signCode = dto.signCode.trim().toUpperCase();
        const duplicate = await signTypes.findOne({
          where: { signCode: ILike(signCode) },
        });
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(`sign_code "${signCode}" exists`);
        }
        signType.signCode = signCode;
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

      await signTypes.save(signType);
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

    return signTypes.map((signType) => ({
      ...signType,
      aiLabelPrompt: promptBySignType.get(signType.id) ?? null,
      osmMapping: mappingsBySignType.get(signType.id)?.join(';') ?? null,
      representativeImageKey: imageBySignType.get(signType.id) ?? null,
    }));
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
      const repository = manager.getRepository(SignTypeImage);
      await repository.update(
        { signTypeId, imageType: 'REPRESENTATIVE', isPrimary: true },
        { isPrimary: false },
      );
      const imageUrl = this.trimToNull(input.representativeImageKey);
      if (imageUrl) {
        await repository.save(
          repository.create({
            signTypeId,
            imageUrl,
            imageType: 'REPRESENTATIVE',
            isPrimary: true,
          }),
        );
      }
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
}
