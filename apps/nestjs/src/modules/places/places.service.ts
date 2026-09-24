import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPlace } from './saved-place.entity';
import { RecentSearch } from './recent-search.entity';

@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(SavedPlace) private places: Repository<SavedPlace>,
    @InjectRepository(RecentSearch) private searches: Repository<RecentSearch>,
  ) {}

  // ── Saved Places ──
  async listSavedPlaces(userId: string) {
    return this.places.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async addSavedPlace(userId: string, dto: { label: string; address: string; latitude: number; longitude: number; placeType?: string }) {
    if (!dto.label?.trim()) throw new BadRequestException('label is required');
    if (!dto.address?.trim()) throw new BadRequestException('address is required');
    if (dto.latitude == null || dto.longitude == null) throw new BadRequestException('latitude and longitude are required');
    const row = this.places.create({
      userId,
      label: dto.label.trim(),
      address: dto.address.trim(),
      latitude: dto.latitude,
      longitude: dto.longitude,
      placeType: (dto.placeType ?? 'SAVED').toUpperCase(),
    } as any);
    return this.places.save(row);
  }

  async removeSavedPlace(userId: string, placeId: string) {
    const p = await this.places.findOne({ where: { id: placeId } });
    if (!p) throw new NotFoundException('SavedPlace ' + placeId + ' not found');
    if (p.userId !== userId) throw new BadRequestException('SavedPlace does not belong to you');
    await this.places.delete({ id: placeId } as any);
    return { deleted: true, id: placeId };
  }

  // ── Recent Searches ──
  async listRecentSearches(userId: string, limit = 20) {
    const n = Math.min(Math.max(1, limit), 50);
    return this.searches.find({ where: { userId }, order: { createdAt: 'DESC' }, take: n });
  }

  async addRecentSearch(userId: string, dto: { query: string; address?: string; latitude?: number; longitude?: number }) {
    if (!dto.query?.trim()) throw new BadRequestException('query is required');
    // Light dedup: remove exact duplicate from last 10, then insert
    const recent: RecentSearch[] = await this.searches.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 10 });
    const dup = recent.find((r) => r.query.trim().toLowerCase() === dto.query.trim().toLowerCase());
    if (dup) await this.searches.delete({ id: dup.id } as any);
    const row = this.searches.create({
      userId,
      query: dto.query.trim(),
      address: dto.address ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    } as any);
    return this.searches.save(row);
  }

  async clearRecentSearches(userId: string) {
    await this.searches.delete({ userId } as any);
    return { cleared: true };
  }

  async deleteRecentSearch(userId: string, searchId: string) {
    const s = await this.searches.findOne({ where: { id: searchId } });
    if (!s) throw new NotFoundException('RecentSearch ' + searchId + ' not found');
    if (s.userId !== userId) throw new BadRequestException('RecentSearch does not belong to you');
    await this.searches.delete({ id: searchId } as any);
    return { deleted: true, id: searchId };
  }
}
