import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (row) => row),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };
    service = new NotificationsService(repo as unknown as Repository<Notification>);
  });

  it('create saves new notification', async () => {
    const res = await service.create('u-1', 'REWARD', 'You got 10 credits', 'Good job', 'submission', 'sub-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        type: 'REWARD',
        title: 'You got 10 credits',
        message: 'Good job',
        isRead: false,
      }),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(res.title).toBe('You got 10 credits');
  });

  it('createBulk returns empty array if input empty, otherwise saves batch', async () => {
    const emptyRes = await service.createBulk([]);
    expect(emptyRes).toEqual([]);
    expect(repo.save).not.toHaveBeenCalled();

    const notifs = [
      { userId: 'u-1', type: 'SYSTEM', title: 'Welcome' },
      { userId: 'u-2', type: 'SYSTEM', title: 'Welcome 2', message: 'Hello' },
    ];
    await service.createBulk(notifs);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenCalled();
  });

  it('listForUser returns paginated notification records', async () => {
    const mockItems = [{ id: 'n-1', userId: 'u-1', isRead: false }];
    repo.findAndCount.mockResolvedValueOnce([mockItems, 1]);

    const res = await service.listForUser('u-1', 1, 20);
    expect(res).toEqual({
      items: mockItems,
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(repo.findAndCount).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      order: { isRead: 'ASC', createdAt: 'DESC' },
      skip: 0,
      take: 20,
    });
  });

  it('markRead returns null if not found or different userId', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const notFound = await service.markRead('u-1', 'n-missing');
    expect(notFound).toBeNull();

    repo.findOne.mockResolvedValueOnce({ id: 'n-1', userId: 'u-other', isRead: false });
    const wrongUser = await service.markRead('u-1', 'n-1');
    expect(wrongUser).toBeNull();
  });

  it('markRead updates isRead to true if not already read', async () => {
    const notif = { id: 'n-1', userId: 'u-1', isRead: false };
    repo.findOne.mockResolvedValueOnce(notif);

    const res = await service.markRead('u-1', 'n-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'n-1' }, { isRead: true });
    expect(res?.isRead).toBe(true);
  });

  it('markRead skips update if already read', async () => {
    const notif = { id: 'n-1', userId: 'u-1', isRead: true };
    repo.findOne.mockResolvedValueOnce(notif);

    const res = await service.markRead('u-1', 'n-1');
    expect(repo.update).not.toHaveBeenCalled();
    expect(res?.isRead).toBe(true);
  });

  it('markAllRead marks all user notifications as read', async () => {
    const res = await service.markAllRead('u-1');
    expect(repo.update).toHaveBeenCalledWith({ userId: 'u-1' }, { isRead: true });
    expect(res).toEqual({ updated: true });
  });

  it('unreadCount counts unread notifications', async () => {
    repo.count.mockResolvedValueOnce(5);
    const res = await service.unreadCount('u-1');
    expect(repo.count).toHaveBeenCalledWith({ where: { userId: 'u-1', isRead: false } });
    expect(res).toEqual({ unreadCount: 5 });
  });
});
