import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SystemParameter,
  ParameterCategory,
  ParameterDataType,
} from './entities/system-parameter.entity';
import { ParameterAuditLog } from './entities/parameter-audit-log.entity';
import { RedisService } from '../../integrations/redis/redis.service';

export const REDIS_PARAMETER_CHANNEL = 'system:parameter:updated';

export const DOMAIN_LABELS: Record<string, string> = {
  CONSENSUS: 'Consensus & Voting',
  REVIEWER: 'Reviewer & Quests',
  REVALIDATION: 'Revalidation & Lifecycles',
  HAZARDS: 'Hazards & Traffic Warnings',
  NAVIGATION: 'Navigation & Routing',
  ECONOMY: 'Economy & Missions',
  INGESTION: 'Ingestion & Surveyor',
  AIOPS: 'AI Operations & Models',
  SECURITY: 'Security & Access',
  INFRASTRUCTURE: 'Infrastructure & System',
};

export function computeParameterRange(
  dataType: ParameterDataType | string,
  rules: Record<string, any> = {},
): string {
  const type = String(dataType || '').toUpperCase();

  if (type === 'BOOLEAN') {
    return 'true - false';
  }

  if (rules.allowedValues && Array.isArray(rules.allowedValues) && rules.allowedValues.length > 0) {
    return rules.allowedValues.map(String).join(', ');
  }

  if (type === 'INTEGER' || type === 'NUMBER' || type === 'PERCENTAGE') {
    const hasMin = rules.min !== undefined && rules.min !== null;
    const hasMax = rules.max !== undefined && rules.max !== null;

    if (hasMin && hasMax) {
      return `${rules.min} - ${rules.max}`;
    }
    if (hasMin) {
      return `>= ${rules.min}`;
    }
    if (hasMax) {
      return `<= ${rules.max}`;
    }
    if (type === 'PERCENTAGE') {
      return '0 - 100';
    }
    if (type === 'INTEGER') {
      return 'Any integer';
    }
    return 'Any number';
  }

  if (type === 'DURATION') {
    return 'Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)';
  }

  if (type === 'JSON') {
    return 'Valid JSON object';
  }

  if (rules.pattern) {
    if (rules.pattern === '^[0-9]+[smhd]$') {
      return 'Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)';
    }
    return `Pattern: ${rules.pattern}`;
  }

  return 'Any string';
}

export function resolveParameterDomain(param: { category?: string; key?: string }): {
  domain: string;
  domainLabel: string;
} {
  let domain = (param.category || '').toUpperCase().trim();
  if (!domain && param.key) {
    domain = param.key.split('.')[0].toUpperCase().trim();
  }
  if (!domain) {
    domain = 'INFRASTRUCTURE';
  }
  const domainLabel = DOMAIN_LABELS[domain] || domain;
  return { domain, domainLabel };
}

export function enrichParameter(param: SystemParameter): SystemParameter {
  const { domain, domainLabel } = resolveParameterDomain(param);
  param.domain = param.domain || domain;
  param.domainLabel = param.domainLabel || domainLabel;
  param.range = param.range || computeParameterRange(param.dataType, param.validationRules || {});
  return param;
}

@Injectable()
export class SystemParametersService implements OnModuleInit {
  private readonly logger = new Logger(SystemParametersService.name);

  // In-memory L1 Cache
  private readonly cache = new Map<string, { param: SystemParameter; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds

  constructor(
    @InjectRepository(SystemParameter)
    private readonly paramRepo: Repository<SystemParameter>,
    @InjectRepository(ParameterAuditLog)
    private readonly auditRepo: Repository<ParameterAuditLog>,
    @Optional()
    private readonly redisService?: RedisService,
  ) {}

  async onModuleInit() {
    // Attempt to warm cache and subscribe to Redis invalidation if available
    try {
      await this.warmCache();
      const redisClient = this.redisService?.getClient();
      if (redisClient) {
        const sub = redisClient.duplicate();
        await sub.connect().catch(() => {});
        sub.subscribe(REDIS_PARAMETER_CHANNEL, (err) => {
          if (!err) {
            this.logger.log(`Subscribed to Redis parameter invalidation channel: ${REDIS_PARAMETER_CHANNEL}`);
          }
        });
        sub.on('message', (channel, message) => {
          if (channel === REDIS_PARAMETER_CHANNEL) {
            try {
              const { key } = JSON.parse(message);
              if (key) {
                this.cache.delete(key);
              }
            } catch {}
          }
        });
      }
    } catch (err: any) {
      this.logger.debug(`Cache warming or Redis subscription skipped: ${err?.message}`);
    }
  }

  private async warmCache(): Promise<void> {
    const all = await this.paramRepo.find();
    const now = Date.now();
    for (const p of all) {
      enrichParameter(p);
      this.cache.set(p.key, { param: p, expiresAt: now + this.CACHE_TTL_MS });
    }
  }

  /**
   * Get parameter by key with L1 caching
   */
  async get(key: string): Promise<SystemParameter | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.param;
    }

    const param = await this.paramRepo.findOne({ where: { key } });
    if (param) {
      enrichParameter(param);
      this.cache.set(key, { param, expiresAt: Date.now() + this.CACHE_TTL_MS });
    }
    return param;
  }

  /**
   * List parameters with optional category and search filter
   */
  async getAll(category?: ParameterCategory, search?: string): Promise<SystemParameter[]> {
    const qb = this.paramRepo.createQueryBuilder('p');
    if (category) {
      qb.andWhere('p.category = :category', { category });
    }
    if (search && search.trim()) {
      qb.andWhere('(p.key ILIKE :search OR p.description ILIKE :search)', {
        search: `%${search.trim()}%`,
      });
    }
    qb.orderBy('p.category', 'ASC').addOrderBy('p.key', 'ASC');
    const list = await qb.getMany();
    return list.map(enrichParameter);
  }

  /**
   * Type-safe typed getters with fallback defaults
   */
  async getString(key: string, defaultValue = ''): Promise<string> {
    const param = await this.get(key);
    return param ? param.value : defaultValue;
  }

  async getNumber(key: string, defaultValue = 0): Promise<number> {
    const param = await this.get(key);
    if (!param) return defaultValue;
    const num = parseFloat(param.value);
    return isNaN(num) ? defaultValue : num;
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const param = await this.get(key);
    if (!param) return defaultValue;
    const val = param.value.trim().toLowerCase();
    return val === 'true' || val === '1' || val === 'yes';
  }

  async getJson<T>(key: string, defaultValue: T): Promise<T> {
    const param = await this.get(key);
    if (!param) return defaultValue;
    try {
      return JSON.parse(param.value) as T;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Strict validation engine enforcing data types and rules
   */
  validateValue(param: SystemParameter, newValue: string): void {
    if (newValue === undefined || newValue === null || String(newValue).trim() === '') {
      throw new BadRequestException(`Value for parameter '${param.key}' cannot be empty.`);
    }

    const rules = param.validationRules || {};

    switch (param.dataType) {
      case ParameterDataType.INTEGER: {
        const intVal = Number(newValue);
        if (!Number.isInteger(intVal)) {
          throw new BadRequestException(`Parameter '${param.key}' must be a valid integer. Received: ${newValue}`);
        }
        if (rules.min !== undefined && intVal < rules.min) {
          throw new BadRequestException(`Value ${intVal} is below minimum allowed (${rules.min}) for '${param.key}'.`);
        }
        if (rules.max !== undefined && intVal > rules.max) {
          throw new BadRequestException(`Value ${intVal} exceeds maximum allowed (${rules.max}) for '${param.key}'.`);
        }
        break;
      }

      case ParameterDataType.NUMBER:
      case ParameterDataType.PERCENTAGE: {
        const floatVal = parseFloat(newValue);
        if (isNaN(floatVal)) {
          throw new BadRequestException(`Parameter '${param.key}' must be a valid number. Received: ${newValue}`);
        }
        if (rules.min !== undefined && floatVal < rules.min) {
          throw new BadRequestException(`Value ${floatVal} is below minimum allowed (${rules.min}) for '${param.key}'.`);
        }
        if (rules.max !== undefined && floatVal > rules.max) {
          throw new BadRequestException(`Value ${floatVal} exceeds maximum allowed (${rules.max}) for '${param.key}'.`);
        }
        break;
      }

      case ParameterDataType.BOOLEAN: {
        const lower = newValue.trim().toLowerCase();
        if (lower !== 'true' && lower !== 'false') {
          throw new BadRequestException(`Parameter '${param.key}' must be 'true' or 'false'. Received: ${newValue}`);
        }
        break;
      }

      case ParameterDataType.JSON: {
        try {
          JSON.parse(newValue);
        } catch (e: any) {
          throw new BadRequestException(`Parameter '${param.key}' must be valid JSON: ${e.message}`);
        }
        break;
      }

      case ParameterDataType.STRING:
      case ParameterDataType.DURATION:
      default: {
        if (Array.isArray(rules.allowedValues) && rules.allowedValues.length > 0) {
          const allowedStr = rules.allowedValues.map(String);
          if (!allowedStr.includes(newValue)) {
            throw new BadRequestException(
              `Value '${newValue}' is not in allowed values: [${allowedStr.join(', ')}] for '${param.key}'.`,
            );
          }
        }
        if (rules.pattern) {
          try {
            const regex = new RegExp(rules.pattern);
            if (!regex.test(newValue)) {
              throw new BadRequestException(
                `Value '${newValue}' does not match required format pattern (${rules.pattern}) for '${param.key}'.`,
              );
            }
          } catch (e: any) {
            this.logger.warn(`Invalid regex pattern configured for '${param.key}': ${rules.pattern}`);
          }
        }
        break;
      }
    }
  }

  /**
   * Atomic update with validation, audit logging, and Redis event publish
   */
  async update(
    key: string,
    value: string,
    changeReason: string,
    changedBy: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<SystemParameter> {
    const param = await this.paramRepo.findOne({ where: { key } });
    if (!param) {
      throw new NotFoundException(`System parameter '${key}' not found.`);
    }

    if (!changeReason || changeReason.trim().length === 0) {
      throw new BadRequestException('A non-empty change reason is mandatory for operational auditing.');
    }

    // 1. Validate value against datatype and constraints
    this.validateValue(param, value);

    const oldValue = param.value;
    param.value = value;
    param.updatedBy = changedBy;
    param.updatedAt = new Date();
    enrichParameter(param);

    // 2. Persist audit log record
    const auditLog = this.auditRepo.create({
      parameterKey: key,
      oldValue,
      newValue: value,
      changeReason: changeReason.trim(),
      changedBy,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      createdAt: new Date(),
    });

    await this.auditRepo.save(auditLog);

    // 3. Persist parameter update
    const saved = await this.paramRepo.save(param);

    // 4. Update L1 Cache
    this.cache.set(key, { param: saved, expiresAt: Date.now() + this.CACHE_TTL_MS });

    // 5. Publish invalidation to Redis channel
    if (this.redisService) {
      try {
        await this.redisService.publish(
          REDIS_PARAMETER_CHANNEL,
          JSON.stringify({ key, value, updatedBy: changedBy, timestamp: Date.now() }),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to publish parameter update to Redis: ${err?.message}`);
      }
    }

    this.logger.log(`Parameter '${key}' updated from '${oldValue}' to '${value}' by user ${changedBy}.`);
    return saved;
  }

  /**
   * Get audit log history for a specific parameter
   */
  async getAuditHistory(key: string, limit = 50): Promise<ParameterAuditLog[]> {
    const exists = await this.paramRepo.findOne({ where: { key } });
    if (!exists) {
      throw new NotFoundException(`System parameter '${key}' not found.`);
    }

    return this.auditRepo.find({
      where: { parameterKey: key },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  /**
   * Rollback parameter to a historical version from audit log
   */
  async rollback(
    key: string,
    targetAuditId: string,
    changeReason: string,
    changedBy: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<SystemParameter> {
    const auditEntry = await this.auditRepo.findOne({
      where: { id: targetAuditId, parameterKey: key },
    });

    if (!auditEntry) {
      throw new NotFoundException(
        `Audit log entry with ID '${targetAuditId}' for parameter '${key}' not found.`,
      );
    }

    // Target value to restore: either oldValue or newValue of the target historical version
    const valueToRestore = auditEntry.oldValue !== null ? auditEntry.oldValue : auditEntry.newValue;
    const effectiveReason = `[ROLLBACK to audit #${targetAuditId}] ${changeReason}`;

    return this.update(key, valueToRestore, effectiveReason, changedBy, ipAddress, userAgent);
  }
}
