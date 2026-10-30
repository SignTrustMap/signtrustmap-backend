import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { DailyTasksController } from './daily-tasks.controller';
import { DailyTasksService } from './daily-tasks.service';

describe('DailyTasksController (Phase 3 Controller Endpoints)', () => {
  let controller: DailyTasksController;
  let service: jest.Mocked<DailyTasksService>;

  const mockUser = { id: 'user-uuid-1', email: 'contributor@stm.dev' };

  beforeEach(() => {
    service = {
      listActive: jest.fn(),
      listTasksWithProgress: jest.fn(),
      listCompletions: jest.fn(),
      getMissionOverview: jest.fn(),
      claim: jest.fn(),
      rolloverUnclaimedTasks: jest.fn(),
    } as unknown as jest.Mocked<DailyTasksService>;

    controller = new DailyTasksController(service);
  });

  it('list delegates to listTasksWithProgress when user is authenticated', async () => {
    const expected = [{ id: 1, taskCode: 'SURVEY_3', progress: 1 }];
    service.listTasksWithProgress.mockResolvedValue(expected as any);

    const result = await controller.list(mockUser);
    expect(service.listTasksWithProgress).toHaveBeenCalledWith(mockUser.id);
    expect(result).toBe(expected);
  });

  it('list delegates to listActive when user is unauthenticated', async () => {
    const expected = [{ id: 1, taskCode: 'SURVEY_3' }];
    service.listActive.mockResolvedValue(expected as any);

    const result = await controller.list(undefined);
    expect(service.listActive).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('myCompletions delegates to service.listCompletions', async () => {
    const expected = [{ id: 'comp-1', dailyTaskId: 1 }];
    service.listCompletions.mockResolvedValue(expected as any);

    const result = await controller.myCompletions(mockUser, '2026-09-25');
    expect(service.listCompletions).toHaveBeenCalledWith(mockUser.id, '2026-09-25');
    expect(result).toBe(expected);
  });

  it('myMissions derives the requested user from the authenticated principal', async () => {
    const expected = { daily: [], weekly: {}, streak: {} };
    service.getMissionOverview.mockResolvedValue(expected as any);

    const result = await controller.myMissions(mockUser);

    expect(service.getMissionOverview).toHaveBeenCalledWith(mockUser.id);
    expect(result).toBe(expected);
  });

  it('claim delegates to service.claim with user and task ID', async () => {
    const expected = { message: 'Claimed', reward: 30 };
    service.claim.mockResolvedValue(expected as any);

    const result = await controller.claim(mockUser, 1);
    expect(service.claim).toHaveBeenCalledWith(mockUser.id, 1);
    expect(result).toBe(expected);
  });

  it('rollover is public with InternalTokenGuard and delegates to rolloverUnclaimedTasks', async () => {
    const expected = { rolledOverDate: '2026-09-24', unclaimedCount: 0 };
    service.rolloverUnclaimedTasks.mockResolvedValue(expected as any);

    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller.rollover);
    expect(isPublic).toBe(true);

    const guards = Reflect.getMetadata('__guards__', controller.rollover);
    expect(guards).toEqual([InternalTokenGuard]);

    const result = await controller.rollover({ date: '2026-09-24' });
    expect(service.rolloverUnclaimedTasks).toHaveBeenCalledWith('2026-09-24');
    expect(result).toBe(expected);
  });
});
