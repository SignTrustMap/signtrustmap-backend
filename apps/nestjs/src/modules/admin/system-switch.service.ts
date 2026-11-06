import { Injectable, Optional, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SystemFeatureFlag } from './system-feature-flag.entity';

export interface CachedFlag {
  isEnabled: boolean;
  metadata: Record<string, any>;
  expiresAt: number;
}

@Injectable()
export class SystemSwitchService {
  private readonly logger = new Logger(SystemSwitchService.name);
  private readonly cache = new Map<string, CachedFlag>();
  private readonly cacheTtlMs = 30000; // 30 seconds

  constructor(
    @Optional()
    @InjectRepository(SystemFeatureFlag)
    private readonly flagRepo?: Repository<SystemFeatureFlag>,
    @Optional()
    private readonly dataSource?: DataSource,
  ) {}

  /**
   * Evaluates if a given system feature flag or bypass is active.
   * If master DEMO_MODE_ACTIVE is true, all demo-category bypasses default to enabled.
   */
  async isEnabled(key: string): Promise<boolean> {
    // If the key is DEMO_MODE_ACTIVE itself, check directly
    if (key === 'DEMO_MODE_ACTIVE') {
      const master = await this.getFlag('DEMO_MODE_ACTIVE');
      return master?.isEnabled ?? false;
    }

    // Check specific flag
    const flag = await this.getFlag(key);
    if (flag?.isEnabled) return true;

    // If flag is not explicitly enabled, check if master DEMO_MODE_ACTIVE is enabled
    const master = await this.getFlag('DEMO_MODE_ACTIVE');
    if (master?.isEnabled) {
      return true;
    }

    return false;
  }

  /**
   * Retrieves metadata attached to a feature flag (e.g. targetEmail for recapture routing)
   */
  async getMetadata<T = any>(key: string): Promise<T | null> {
    const flag = await this.getFlag(key);
    return (flag?.metadata as T) ?? null;
  }

  /**
   * Retrieves single feature flag with in-memory caching
   */
  async getFlag(key: string): Promise<SystemFeatureFlag | null> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return {
        key,
        name: key,
        description: null,
        category: 'DEMO',
        isEnabled: cached.isEnabled,
        metadata: cached.metadata,
        updatedAt: new Date(cached.expiresAt - this.cacheTtlMs),
        updatedBy: null,
      };
    }

    try {
      if (this.flagRepo && typeof this.flagRepo.findOne === 'function') {
        const entity = await this.flagRepo.findOne({ where: { key } });
        if (entity) {
          this.cache.set(key, {
            isEnabled: entity.isEnabled,
            metadata: entity.metadata || {},
            expiresAt: now + this.cacheTtlMs,
          });
          return entity;
        }
      } else if (this.dataSource && typeof this.dataSource.query === 'function') {
        const rows = await this.dataSource.query(
          `SELECT * FROM system_feature_flags WHERE key = $1 LIMIT 1`,
          [key],
        );
        if (rows[0]) {
          const mapped: SystemFeatureFlag = {
            key: rows[0].key,
            name: rows[0].name,
            description: rows[0].description,
            category: rows[0].category,
            isEnabled: Boolean(rows[0].is_enabled),
            metadata: rows[0].metadata || {},
            updatedAt: rows[0].updated_at,
            updatedBy: rows[0].updated_by,
          };
          this.cache.set(key, {
            isEnabled: mapped.isEnabled,
            metadata: mapped.metadata || {},
            expiresAt: now + this.cacheTtlMs,
          });
          return mapped;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed to read feature flag ${key}: ${err?.message}`);
    }

    // Default safe fallback if database row doesn't exist
    return {
      key,
      name: key,
      description: null,
      category: 'DEMO',
      isEnabled: false,
      metadata: {},
      updatedAt: new Date(),
      updatedBy: null,
    };
  }

  /**
   * Lists all registered system feature flags
   */
  async getAllFlags(): Promise<SystemFeatureFlag[]> {
    try {
      if (this.flagRepo && typeof this.flagRepo.find === 'function') {
        return await this.flagRepo.find({ order: { category: 'ASC', key: 'ASC' } });
      }
      if (this.dataSource && typeof this.dataSource.query === 'function') {
        const rows = await this.dataSource.query(
          `SELECT * FROM system_feature_flags ORDER BY category ASC, key ASC`,
        );
        return rows.map((r: any) => ({
          key: r.key,
          name: r.name,
          description: r.description,
          category: r.category,
          isEnabled: Boolean(r.is_enabled),
          metadata: r.metadata || {},
          updatedAt: r.updated_at,
          updatedBy: r.updated_by,
        }));
      }
    } catch (err: any) {
      this.logger.warn(`Failed to list feature flags: ${err?.message}`);
    }
    return [];
  }

  /**
   * Updates a single feature flag and logs the mutation into audit_logs
   */
  async setFlag(
    key: string,
    isEnabled: boolean,
    metadata?: Record<string, any>,
    userId?: string,
    reason?: string,
    ipAddress?: string,
  ): Promise<SystemFeatureFlag> {
    const existing = await this.getFlag(key);
    if (!existing) {
      throw new NotFoundException(`Feature flag '${key}' not found`);
    }

    const mergedMetadata = metadata !== undefined ? metadata : (existing.metadata || {});

    if (this.flagRepo && typeof this.flagRepo.save === 'function') {
      existing.isEnabled = isEnabled;
      existing.metadata = mergedMetadata;
      existing.updatedBy = userId ?? null;
      await this.flagRepo.save(existing);
    } else if (this.dataSource && typeof this.dataSource.query === 'function') {
      await this.dataSource.query(
        `UPDATE system_feature_flags
         SET is_enabled = $1, metadata = $2, updated_by = $3, updated_at = NOW()
         WHERE key = $4`,
        [isEnabled, JSON.stringify(mergedMetadata), userId ?? null, key],
      );
    }

    this.cache.set(key, {
      isEnabled,
      metadata: mergedMetadata,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    // Record in audit_logs
    try {
      if (this.dataSource && typeof this.dataSource.query === 'function') {
        await this.dataSource.query(
          `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
           VALUES ($1, 'UPDATE_SYSTEM_FLAG', 'system_feature_flags', $2, $3, $4, $5)`,
          [
            userId ?? null,
            key,
            JSON.stringify({ isEnabled: existing.isEnabled, metadata: existing.metadata }),
            JSON.stringify({ isEnabled, metadata: mergedMetadata, reason: reason ?? null }),
            ipAddress ?? null,
          ],
        );
      }
    } catch (auditErr: any) {
      this.logger.warn(`Audit log failed for setFlag(${key}): ${auditErr?.message}`);
    }

    return this.getFlag(key) as Promise<SystemFeatureFlag>;
  }

  /**
   * One-click action to enable Master Demo Mode and all presentation shortcuts
   */
  async enableDemoMode(
    targetEmail = 'demo@stm.dev',
    userId?: string,
    reason = 'Admin enabled demo mode for presentation',
    ipAddress?: string,
  ): Promise<SystemFeatureFlag[]> {
    const flagsToEnable = [
      { key: 'DEMO_MODE_ACTIVE', isEnabled: true, metadata: { targetEmail } },
      { key: 'ALLOW_SELF_REVIEW', isEnabled: true },
      { key: 'SINGLE_VOTE_CONSENSUS', isEnabled: true },
      { key: 'BYPASS_RECAPTURE_GEOFENCE', isEnabled: true },
      { key: 'AUTO_ASSIGN_RECAPTURE_EMAIL', isEnabled: true, metadata: { targetEmail } },
      { key: 'ENABLE_TEST_UTILITY_ENDPOINTS', isEnabled: true },
    ];

    for (const f of flagsToEnable) {
      await this.setFlag(f.key, f.isEnabled, f.metadata, userId, reason, ipAddress);
    }

    this.clearCache();
    return this.getAllFlags();
  }

  /**
   * One-click action to reset the system to strict production rules
   */
  async disableDemoMode(
    userId?: string,
    reason = 'Admin reset system to strict production standards',
    ipAddress?: string,
  ): Promise<SystemFeatureFlag[]> {
    const flagsToDisable = [
      'DEMO_MODE_ACTIVE',
      'ALLOW_SELF_REVIEW',
      'SINGLE_VOTE_CONSENSUS',
      'BYPASS_RECAPTURE_GEOFENCE',
      'AUTO_ASSIGN_RECAPTURE_EMAIL',
      'ENABLE_TEST_UTILITY_ENDPOINTS',
    ];

    for (const k of flagsToDisable) {
      await this.setFlag(k, false, {}, userId, reason, ipAddress);
    }

    this.clearCache();
    return this.getAllFlags();
  }

  clearCache(): void {
    this.cache.clear();
  }
}
