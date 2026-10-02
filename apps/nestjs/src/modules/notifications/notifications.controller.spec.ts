import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    unreadCount: jest.Mock;
    listForUser: jest.Mock;
    markAllRead: jest.Mock;
    markRead: jest.Mock;
  };

  const mockUser = { id: 'u-100', role: 'driver' };

  beforeEach(() => {
    service = {
      unreadCount: jest.fn().mockResolvedValue({ unreadCount: 3 }),
      listForUser: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      markAllRead: jest.fn().mockResolvedValue({ updated: true }),
      markRead: jest.fn().mockResolvedValue({ id: 'notif-1', isRead: true }),
    };
    controller = new NotificationsController(service as unknown as NotificationsService);
  });

  it('unreadCount delegates to service.unreadCount', async () => {
    const res = await controller.unreadCount(mockUser);
    expect(res).toEqual({ unreadCount: 3 });
    expect(service.unreadCount).toHaveBeenCalledWith(mockUser.id);
  });

  it('list delegates to service.listForUser with parsed numbers', async () => {
    await controller.list(mockUser, '2', '10');
    expect(service.listForUser).toHaveBeenCalledWith(mockUser.id, 2, 10);

    // Fallback on invalid query params
    await controller.list(mockUser, 'invalid', 'bad');
    expect(service.listForUser).toHaveBeenCalledWith(mockUser.id, 1, 20);
  });

  it('markAllRead delegates to service.markAllRead', async () => {
    const res = await controller.markAllRead(mockUser);
    expect(res).toEqual({ updated: true });
    expect(service.markAllRead).toHaveBeenCalledWith(mockUser.id);
  });

  it('markRead delegates to service.markRead', async () => {
    const res = await controller.markRead(mockUser, 'notif-1');
    expect(res).toEqual({ id: 'notif-1', isRead: true });
    expect(service.markRead).toHaveBeenCalledWith(mockUser.id, 'notif-1');
  });
});
