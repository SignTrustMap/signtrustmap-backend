import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  // In-memory mutex fallback for local development or test suites without live Redis
  private readonly inMemoryLocks = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') ||
      process.env.REDIS_URL ||
      'redis://localhost:6379/1';

    try {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // Do not spam reconnects in unit tests
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Redis connected for distributed locks: ${redisUrl}`);
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.debug(`Redis connection error (${err.message}). Using in-memory mutex fallback.`);
      });

      // Attempt initial connection without crashing if Redis is offline
      this.client.connect().catch(() => {
        this.isConnected = false;
      });
    } catch (err: any) {
      this.logger.debug(`Redis initialization skipped (${err.message}). Using in-memory fallback.`);
    }
  }

  /**
   * Acquire a distributed lock with TTL in milliseconds (Redlock single-instance mutex)
   * Returns unique lock token if acquired, or null if lock is already held.
   */
  async acquireLock(lockKey: string, ttlMs: number = 10000): Promise<string | null> {
    const token = uuidv4();

    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');
        if (result === 'OK') {
          return token;
        }
        return null;
      } catch (err: any) {
        this.logger.debug(`Redis acquireLock failed (${err.message}), attempting in-memory fallback`);
      }
    }

    // In-memory fallback
    const now = Date.now();
    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.expiresAt > now) {
      return null;
    }

    this.inMemoryLocks.set(lockKey, { token, expiresAt: now + ttlMs });
    return token;
  }

  /**
   * Release a distributed lock atomically using Lua script (verifying lock token ownership)
   */
  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        const result = await this.client.eval(luaScript, 1, lockKey, token);
        return result === 1;
      } catch (err: any) {
        this.logger.debug(`Redis releaseLock failed (${err.message})`);
      }
    }

    // In-memory fallback
    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.token === token) {
      this.inMemoryLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {}
    }
  }
}
