import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignCategory } from '../../entities/sign-category.entity';
import { TrafficSignType } from '../../entities/traffic-sign-type.entity';
import { SystemParameter } from '../../entities/system-parameter.entity';
import { CreateSignCategoryDto, UpdateSignCategoryDto, CreateSignTypeDto, UpdateSignTypeDto, UpsertSystemParameterDto } from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(SignCategory) private cat: Repository<SignCategory>,
    @InjectRepository(TrafficSignType) private typ: Repository<TrafficSignType>,
    @InjectRepository(SystemParameter) private par: Repository<SystemParameter>,
  ) {}

  listCategories() { return this.cat.find({ order: { sortOrder: 'ASC', id: 'ASC' } }); }

  async getCategory(id: number) {
    const c = await this.cat.findOne({ where: { id } });
    if (!c) throw new NotFoundException('SignCategory #' + id + ' not found');
    return c;
  }

  async createCategory(dto: CreateSignCategoryDto) {
    if (await this.cat.findOne({ where: { code: dto.code } }))
      throw new ConflictException('code "' + dto.code + '" exists');
    return this.cat.save(this.cat.create({
      code: dto.code, nameVi: dto.nameVi, nameEn: dto.nameEn,
      description: dto.description ?? null, iconUrl: dto.iconUrl ?? null, sortOrder: dto.sortOrder ?? 0,
    }));
  }

  async updateCategory(id: number, dto: UpdateSignCategoryDto) {
    const c = await this.cat.findOne({ where: { id } });
    if (!c) throw new NotFoundException('SignCategory #' + id + ' not found');
    if (dto.code && dto.code !== c.code && await this.cat.findOne({ where: { code: dto.code } }))
      throw new ConflictException('code "' + dto.code + '" exists');
    if (dto.code !== undefined) c.code = dto.code;
    if (dto.nameVi !== undefined) c.nameVi = dto.nameVi;
    if (dto.nameEn !== undefined) c.nameEn = dto.nameEn;
    if (dto.description !== undefined) (c as any).description = dto.description;
    if (dto.iconUrl !== undefined) (c as any).iconUrl = dto.iconUrl;
    if (dto.sortOrder !== undefined) c.sortOrder = dto.sortOrder;
    return this.cat.save(c);
  }

  async deleteCategory(id: number) {
    const c = await this.cat.findOne({ where: { id } });
    if (!c) throw new NotFoundException('SignCategory #' + id + ' not found');
    const n = await this.typ.count({ where: { categoryId: id } });
    if (n > 0) throw new BadRequestException('Cannot delete: ' + n + ' sign type(s) reference category #' + id + '.');
    await this.cat.delete(id);
    return { deleted: true, id };
  }

  listSignTypes(categoryId?: number, isActive?: boolean, search?: string) {
    const qb = this.typ.createQueryBuilder('t').leftJoinAndSelect('t.category','c').orderBy('t.signCode','ASC');
    if (categoryId !== undefined) qb.andWhere('t.categoryId = :categoryId', { categoryId });
    if (isActive !== undefined) qb.andWhere('t.isActive = :isActive', { isActive });
    if (search) qb.andWhere('(t.signCode ILIKE :s OR t.nameVi ILIKE :s OR t.nameEn ILIKE :s)', { s: `%${search}%` });
    return qb.getMany();
  }
  async getSignType(id: number) {
    const t = await this.typ.findOne({ where: { id }, relations: ['category'] });
    if (!t) throw new NotFoundException('TrafficSignType #' + id + ' not found');
    return t;
  }

  async createSignType(dto: CreateSignTypeDto) {
    if (!await this.cat.findOne({ where: { id: dto.categoryId } }))
      throw new BadRequestException('SignCategory #' + dto.categoryId + ' not found');
    if (await this.typ.findOne({ where: { signCode: dto.signCode } }))
      throw new ConflictException('sign_code "' + dto.signCode + '" exists');
    const now = new Date();
    return this.typ.save(this.typ.create({
      categoryId: dto.categoryId, signCode: dto.signCode, nameVi: dto.nameVi, nameEn: dto.nameEn,
      description: dto.description ?? null, labelingGuidelines: dto.labelingGuidelines ?? null,
      shape: dto.shape ?? null, colorScheme: dto.colorScheme ?? null, isActive: dto.isActive ?? true,
      createdAt: now, updatedAt: now,
    }));
  }

  async updateSignType(id: number, dto: UpdateSignTypeDto) {
    const t = await this.typ.findOne({ where: { id } });
    if (!t) throw new NotFoundException('TrafficSignType #' + id + ' not found');
    if (dto.categoryId !== undefined && !await this.cat.findOne({ where: { id: dto.categoryId } }))
      throw new BadRequestException('SignCategory #' + dto.categoryId + ' not found');
    if (dto.signCode && dto.signCode !== t.signCode && await this.typ.findOne({ where: { signCode: dto.signCode } }))
      throw new ConflictException('sign_code "' + dto.signCode + '" exists');
    if (dto.categoryId !== undefined) t.categoryId = dto.categoryId;
    if (dto.signCode !== undefined) t.signCode = dto.signCode;
    if (dto.nameVi !== undefined) t.nameVi = dto.nameVi;
    if (dto.nameEn !== undefined) t.nameEn = dto.nameEn;
    if (dto.description !== undefined) (t as any).description = dto.description;
    if (dto.labelingGuidelines !== undefined) (t as any).labelingGuidelines = dto.labelingGuidelines;
    if (dto.shape !== undefined) (t as any).shape = dto.shape;
    if (dto.colorScheme !== undefined) (t as any).colorScheme = dto.colorScheme;
    if (dto.isActive !== undefined) t.isActive = dto.isActive;
    (t as any).updatedAt = new Date();
    return this.typ.save(t);
  }

  async deleteSignType(id: number) {
    const t = await this.typ.findOne({ where: { id } });
    if (!t) throw new NotFoundException('TrafficSignType #' + id + ' not found');
    (t as any).isActive = false;
    (t as any).updatedAt = new Date();
    await this.typ.save(t);
    return { deleted: true, id, note: 'Soft-deleted: isActive=false' };
  }

  listParameters() { return this.par.find({ order: { key: 'ASC' } }); }

  async getParameter(key: string) {
    const p = await this.par.findOne({ where: { key } });
    if (!p) throw new NotFoundException('System parameter "' + key + '" not found');
    return p;
  }

  async upsertParameter(key: string, dto: UpsertSystemParameterDto, by: string) {
    let p = await this.par.findOne({ where: { key } });
    if (p) { p.value = dto.value; if (dto.description !== undefined) p.description = dto.description; p.updatedBy = by; return this.par.save(p); }
    return this.par.save(this.par.create({ key, value: dto.value, description: dto.description ?? null, updatedBy: by } as any));
  }
}

