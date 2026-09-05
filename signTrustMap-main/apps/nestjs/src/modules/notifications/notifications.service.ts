import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
  ) {}

  async create(
    userId: string,
    type: string,
    title: string,
    message?: string,
    relatedEntityType?: string,
    relatedEntityId?: string,
  ): Promise<Notification> {
    const row = this.repo.create({
      userId,
      type,
      title,
      message: message ?? null,
      relatedEntityType: relatedEntityType ?? null,
      relatedEntityId: relatedEntityId ?? null,
      isRead: false,
    } as any);
    return this.repo.save(row) as unknown as Promise<Notification>;
  }

  async createBulk(notifs: Array<{ userId: string; type: string; title: string; message?: string; relatedEntityType?: string; relatedEntityId?: string }>) {
    const rows: Array<Notification> = notifs.map((n) =>
      this.repo.create({
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message ?? null,
        relatedEntityType: n.relatedEntityType ?? null,
        relatedEntityId: n.relatedEntityId ?? null,
        isRead: false,
      }) as unknown as Notification,
    );
    if (rows.length === 0) return [];
    return this.repo.save(rows) as unknown as Promise<Notification[]>;
  }

  async listForUser(userId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await this.repo.findAndCount({
      where: { userId } as any,
      order: { isRead: 'ASC' as any, createdAt: 'DESC' },
      skip: (p - 1) * ps,
      take: ps,
    });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async markRead(userId: string, notificationId: string) {
    const n = await this.repo.findOne({ where: { id: notificationId } as any });
    if (!n) return null;
    if (n.userId !== userId) return null;
    if (!n.isRead) {
      await this.repo.update({ id: notificationId } as any, { isRead: true } as any);
      n.isRead = true;
    }
    return n;
  }

  async markAllRead(userId: string) {
    await this.repo.update({ userId } as any, { isRead: true } as any);
    return { updated: true };
  }

  async unreadCount(userId: string) {
    const count = await this.repo.count({ where: { userId, isRead: false } as any });
    return { unreadCount: count };
  }
}
