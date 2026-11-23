import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  SystemParametersService,
  computeParameterRange,
  resolveParameterDomain,
  enrichParameter,
} from './system-parameters.service';
import {
  SystemParameter,
  ParameterCategory,
  ParameterDataType,
} from './entities/system-parameter.entity';

describe('SystemParametersService & Input Range Guidance', () => {
  describe('computeParameterRange', () => {
    it('returns "true - false" for BOOLEAN data type', () => {
      expect(computeParameterRange(ParameterDataType.BOOLEAN)).toBe('true - false');
      expect(computeParameterRange('BOOLEAN', { allowedValues: [true, false] })).toBe('true - false');
    });

    it('returns numeric range string for min and max bounds', () => {
      expect(computeParameterRange(ParameterDataType.INTEGER, { min: 0, max: 100, step: 1 })).toBe('0 - 100');
      expect(computeParameterRange(ParameterDataType.NUMBER, { min: 0.1, max: 1.0, step: 0.05 })).toBe('0.1 - 1');
      expect(computeParameterRange(ParameterDataType.NUMBER, { min: -1.0, max: -0.1 })).toBe('-1 - -0.1');
    });

    it('returns single-sided bounds when only min or max is provided', () => {
      expect(computeParameterRange(ParameterDataType.INTEGER, { min: 10 })).toBe('>= 10');
      expect(computeParameterRange(ParameterDataType.NUMBER, { max: 50.5 })).toBe('<= 50.5');
    });

    it('returns comma-separated allowed values when specified', () => {
      expect(computeParameterRange(ParameterDataType.STRING, { allowedValues: ['r3_cec', 'entropy', 'margin'] })).toBe(
        'r3_cec, entropy, margin',
      );
    });

    it('returns duration format guidance for regex pattern or duration type', () => {
      expect(computeParameterRange(ParameterDataType.STRING, { pattern: '^[0-9]+[smhd]$' })).toBe(
        'Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)',
      );
      expect(computeParameterRange(ParameterDataType.DURATION)).toBe('Format: [number][s|m|h|d] (e.g. 15m, 1h, 7d)');
    });

    it('returns default fallback for unconstrained types', () => {
      expect(computeParameterRange(ParameterDataType.STRING)).toBe('Any string');
      expect(computeParameterRange(ParameterDataType.JSON)).toBe('Valid JSON object');
    });
  });

  describe('resolveParameterDomain', () => {
    it('maps category to domain and human-friendly domain label', () => {
      const consensus = resolveParameterDomain({ category: 'CONSENSUS', key: 'consensus.approval_threshold' });
      expect(consensus.domain).toBe('CONSENSUS');
      expect(consensus.domainLabel).toBe('Consensus & Voting');

      const ingestion = resolveParameterDomain({ category: 'INGESTION', key: 'survey.manual_annotation_enabled' });
      expect(ingestion.domain).toBe('INGESTION');
      expect(ingestion.domainLabel).toBe('Ingestion & Surveyor');

      const aiops = resolveParameterDomain({ category: 'AIOPS', key: 'ai.classifier.conf_thresh' });
      expect(aiops.domain).toBe('AIOPS');
      expect(aiops.domainLabel).toBe('AI Operations & Models');
    });

    it('falls back to key prefix if category is missing', () => {
      const res = resolveParameterDomain({ key: 'hazards.initial_ttl_minutes' });
      expect(res.domain).toBe('HAZARDS');
      expect(res.domainLabel).toBe('Hazards & Traffic Warnings');
    });
  });

  describe('enrichParameter', () => {
    it('populates domain, domainLabel, and range on a SystemParameter entity', () => {
      const param = new SystemParameter();
      param.key = 'survey.manual_annotation_reward_credits';
      param.value = '35';
      param.category = ParameterCategory.INGESTION;
      param.dataType = ParameterDataType.INTEGER;
      param.validationRules = { min: 10, max: 200, step: 5 };

      const enriched = enrichParameter(param);
      expect(enriched.domain).toBe('INGESTION');
      expect(enriched.domainLabel).toBe('Ingestion & Surveyor');
      expect(enriched.range).toBe('10 - 200');
    });
  });

  describe('SystemParametersService service operations', () => {
    let service: SystemParametersService;
    let mockParamRepo: any;
    let mockAuditRepo: any;
    let mockRedisService: any;

    beforeEach(() => {
      mockParamRepo = {
        find: jest.fn(),
        findOne: jest.fn(),
        createQueryBuilder: jest.fn(),
        save: jest.fn((p) => Promise.resolve(p)),
      };
      mockAuditRepo = {
        create: jest.fn((dto) => dto),
        save: jest.fn((a) => Promise.resolve(a)),
        findOne: jest.fn(),
        find: jest.fn(),
      };
      mockRedisService = {
        publish: jest.fn().mockResolvedValue(1),
        getClient: jest.fn().mockReturnValue(null),
      };

      service = new SystemParametersService(mockParamRepo, mockAuditRepo, mockRedisService);
    });

    it('getAll returns enriched parameters including domain and range', async () => {
      const rawParam = {
        key: 'consensus.approval_threshold',
        value: '0.5',
        category: ParameterCategory.CONSENSUS,
        dataType: ParameterDataType.NUMBER,
        validationRules: { min: 0.1, max: 1.0, step: 0.05 },
      };

      const mockQb: any = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([rawParam]),
      };
      mockParamRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getAll();
      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe('CONSENSUS');
      expect(result[0].domainLabel).toBe('Consensus & Voting');
      expect(result[0].range).toBe('0.1 - 1');
    });

    it('get returns enriched parameter by key', async () => {
      const rawParam = {
        key: 'survey.manual_annotation_enabled',
        value: 'true',
        category: ParameterCategory.INGESTION,
        dataType: ParameterDataType.BOOLEAN,
        validationRules: { allowedValues: [true, false] },
      };
      mockParamRepo.findOne.mockResolvedValue(rawParam);

      const result = await service.get('survey.manual_annotation_enabled');
      expect(result).not.toBeNull();
      expect(result?.domain).toBe('INGESTION');
      expect(result?.range).toBe('true - false');
    });

    it('update rejects out-of-range value with clean BadRequestException', async () => {
      const param = {
        key: 'consensus.consecutive_error_limit',
        value: '3',
        category: ParameterCategory.CONSENSUS,
        dataType: ParameterDataType.INTEGER,
        validationRules: { min: 1, max: 10, step: 1 },
      };
      mockParamRepo.findOne.mockResolvedValue(param);

      // Attempt out-of-range value 15 (max is 10)
      await expect(
        service.update('consensus.consecutive_error_limit', '15', 'tuning limits', 'admin-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('update accepts valid range, persists domain & range, and publishes to Redis', async () => {
      const param = {
        key: 'consensus.consecutive_error_limit',
        value: '3',
        category: ParameterCategory.CONSENSUS,
        dataType: ParameterDataType.INTEGER,
        validationRules: { min: 1, max: 10, step: 1 },
      };
      mockParamRepo.findOne.mockResolvedValue(param);

      const updated = await service.update(
        'consensus.consecutive_error_limit',
        '5',
        'adjusted based on review stats',
        'admin-uuid',
      );

      expect(updated.value).toBe('5');
      expect(updated.domain).toBe('CONSENSUS');
      expect(updated.range).toBe('1 - 10');
      expect(mockAuditRepo.save).toHaveBeenCalled();
      expect(mockParamRepo.save).toHaveBeenCalled();
      expect(mockRedisService.publish).toHaveBeenCalled();
    });

    it('update updates description when provided', async () => {
      const param = {
        key: 'ai.active_learning.strategy',
        value: 'r3_cec',
        category: ParameterCategory.AIOPS,
        dataType: ParameterDataType.STRING,
        validationRules: { allowedValues: ['r3_cec', 'entropy', 'margin'] },
        description: 'Old description',
      };
      mockParamRepo.findOne.mockResolvedValue(param);

      const updated = await service.update(
        'ai.active_learning.strategy',
        'entropy',
        'switch to entropy',
        'admin-uuid',
        null,
        null,
        'Updated description',
      );

      expect(updated.value).toBe('entropy');
      expect(updated.description).toBe('Updated description');
      expect(mockParamRepo.save).toHaveBeenCalled();
    });

    it('rollback restores previous value from audit history and preserves domain and range', async () => {
      const param = {
        key: 'consensus.consecutive_error_limit',
        value: '5',
        category: ParameterCategory.CONSENSUS,
        dataType: ParameterDataType.INTEGER,
        validationRules: { min: 1, max: 10, step: 1 },
      };
      mockParamRepo.findOne.mockResolvedValue(param);

      mockAuditRepo.findOne.mockResolvedValue({
        id: '101',
        parameterKey: 'consensus.consecutive_error_limit',
        oldValue: '3',
        newValue: '5',
      });

      const rolledBack = await service.rollback(
        'consensus.consecutive_error_limit',
        '101',
        'revert erroneous change',
        'admin-uuid',
      );

      expect(rolledBack.value).toBe('3');
      expect(rolledBack.domain).toBe('CONSENSUS');
      expect(rolledBack.range).toBe('1 - 10');
    });

    it('throws NotFoundException for non-existent key', async () => {
      mockParamRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('non.existent.key', '1', 'reason', 'admin-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
