import { RedisService } from './redis.service';

describe('RedisService (Distributed Redlock Mutex Tests)', () => {
  let service: RedisService;
  let configService: any;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue(null),
    };
    service = new RedisService(configService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('acquires lock and returns token when key is free', async () => {
    const token = await service.acquireLock('test:lock:1', 5000);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  it('returns null when lock key is already held', async () => {
    const token1 = await service.acquireLock('test:lock:2', 5000);
    expect(token1).toBeTruthy();

    const token2 = await service.acquireLock('test:lock:2', 5000);
    expect(token2).toBeNull();
  });

  it('releases lock when provided with matching token', async () => {
    const token = await service.acquireLock('test:lock:3', 5000);
    expect(token).toBeTruthy();

    const released = await service.releaseLock('test:lock:3', token!);
    expect(released).toBe(true);

    // Can be acquired again after release
    const tokenAfter = await service.acquireLock('test:lock:3', 5000);
    expect(tokenAfter).toBeTruthy();
  });

  it('fails to release lock when token does not match', async () => {
    const token = await service.acquireLock('test:lock:4', 5000);
    expect(token).toBeTruthy();

    const released = await service.releaseLock('test:lock:4', 'wrong-token');
    expect(released).toBe(false);

    // Still locked
    const nextAcquire = await service.acquireLock('test:lock:4', 5000);
    expect(nextAcquire).toBeNull();
  });

  it('acquires and releases lock via Redis client when connected', async () => {
    const mockClient = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    (service as any).client = mockClient;
    (service as any).isConnected = true;

    const token = await service.acquireLock('key:connected', 5000);
    expect(token).toBeTruthy();
    expect(mockClient.set).toHaveBeenCalled();

    const released = await service.releaseLock('key:connected', token!);
    expect(released).toBe(true);
    expect(mockClient.eval).toHaveBeenCalled();
  });
});
