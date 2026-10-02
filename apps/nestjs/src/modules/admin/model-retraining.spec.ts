import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { MlopsController } from './mlops.controller';
import { TriggerRetrainDto, ActiveLearningConfigDto } from './dto/admin.dto';

describe('ModelRetrainingSpec (MLOps Flow 14 & Req 1.5)', () => {
  let adminService: AdminService;
  let adminController: AdminController;
  let mlopsController: MlopsController;

  const mockDataSource = {
    query: jest.fn(),
  };

  const mockWalletService = {
    manualAdjustment: jest.fn(),
    freezeWallet: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    adminService = new AdminService(mockDataSource as any);
    adminController = new AdminController(adminService, mockWalletService as any);
    mlopsController = new MlopsController(adminService);
  });

  it('ML-001: should trigger retraining run when verified dataset meets >= 50 threshold', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ cnt: 120 }]) // verified count check
      .mockResolvedValueOnce([
        {
          id: 'job-uuid-123',
          model_type: 'YOLO12',
          status: 'QUEUED',
          started_at: new Date('2026-10-02T10:00:00Z'),
        },
      ]) // insert model_training_jobs
      .mockResolvedValueOnce([]); // insert audit_logs

    const dto: TriggerRetrainDto = {
      modelType: 'YOLO12',
      datasetSplitRatio: 0.8,
      notes: 'Active learning cycle 4',
    };

    const res = await adminService.triggerModelRetraining(dto, 'admin-uuid-1');

    expect(res).toBeDefined();
    expect(res.id).toBe('job-uuid-123');
    expect(res.modelName).toBe('YOLO12-Detector');
    expect(res.trainingSamplesCount).toBe(120);
    expect(res.status).toBe('Ready for Deployment');
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO model_training_jobs'),
      expect.arrayContaining(['YOLO12', 'admin-uuid-1']),
    );
  });

  it('ML-002: should throw BadRequestException if dataset samples fall below minimum threshold', async () => {
    mockDataSource.query.mockResolvedValueOnce([{ cnt: 12 }]); // only 12 verified signs

    const dto: TriggerRetrainDto = {
      modelType: 'YOLO12',
      minSampleThreshold: 50,
    };

    await expect(
      adminService.triggerModelRetraining(dto, 'admin-uuid-1'),
    ).rejects.toThrow(BadRequestException);

    expect(mockDataSource.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO model_training_jobs'),
      expect.anything(),
    );
  });

  it('ML-003: should list paginated training jobs with duration and metrics', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ cnt: 2 }]) // count
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          model_type: 'YOLO12',
          triggered_by_name: 'Admin User',
          version_tag: 'yolo12-stm-v2.3',
          started_at: '2026-10-01T02:00:00Z',
          completed_at: '2026-10-01T04:30:00Z',
          status: 'COMPLETED',
        },
        {
          id: 'job-2',
          model_type: 'CLIP',
          triggered_by_name: 'Admin User',
          version_tag: 'clip-stm-v1.2',
          started_at: '2026-10-02T01:00:00Z',
          completed_at: null,
          status: 'RUNNING',
        },
      ]); // items

    const res = await adminService.listTrainingJobs({ page: 1, pageSize: 10 });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].modelName).toBe('YOLO12-Detector');
    expect(res.items[0].status).toBe('Active Deployed');
    expect(res.items[0].duration).toBe('150m');
    expect(res.items[1].modelName).toBe('CLIP-ZeroShot-Classifier');
    expect(res.items[1].status).toBe('Evaluating');
  });

  it('ML-004: should govern candidate promotion by deactivating old active version and activating target', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        { id: 42, model_type: 'YOLO12', version_tag: 'yolo12-v2.4-retrained' },
      ]) // find version
      .mockResolvedValueOnce([]) // deactivate previous
      .mockResolvedValueOnce([]) // activate target
      .mockResolvedValueOnce([]); // insert audit_log

    const res = await adminService.promoteModelVersion(42, 'admin-uuid-1', '127.0.0.1');

    expect(res).toBeDefined();
    expect(res.versionId).toBe(42);
    expect(res.isActive).toBe(true);
    expect(res.versionTag).toBe('yolo12-v2.4-retrained');

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ai_model_versions SET is_active = false WHERE model_type = $1'),
      ['YOLO12'],
    );
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ai_model_versions SET is_active = true WHERE id = $1'),
      [42],
    );
  });

  it('ML-005: should throw NotFoundException when promoting non-existent model version', async () => {
    mockDataSource.query.mockResolvedValueOnce([]); // empty result

    await expect(
      adminService.promoteModelVersion(9999, 'admin-uuid-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('ML-006: should rollback active model version and reactivate previous', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        { id: 42, model_type: 'YOLO12', version_tag: 'yolo12-v2.4', is_active: true },
      ]) // target
      .mockResolvedValueOnce([]) // deactivate target
      .mockResolvedValueOnce([{ id: 41, version_tag: 'yolo12-v2.3' }]) // find prev
      .mockResolvedValueOnce([]) // reactivate prev
      .mockResolvedValueOnce([]); // audit log

    const res = await adminService.rollbackModelVersion(42, 'admin-uuid-1');

    expect(res.versionId).toBe(42);
    expect(res.rolledBack).toBe(true);
    expect(res.reactivatedVersion).toBe('yolo12-v2.3');
  });

  it('ML-007: should return pipeline status with active detectors and classifiers', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ version_tag: 'YOLOv12x-v2.3' }]) // yolo
      .mockResolvedValueOnce([{ version_tag: 'CLIP-ViT-B-32-v1.0' }]) // clip
      .mockResolvedValueOnce([{ cnt: 1 }]) // pending
      .mockResolvedValueOnce([{ completed_at: new Date('2026-10-01T12:00:00Z') }]); // last completed

    const res = await adminService.getPipelineStatus();

    expect(res.status).toBe('HEALTHY');
    expect(res.activeDetector).toBe('YOLOv12x-v2.3');
    expect(res.activeClassifier).toBe('CLIP-ViT-B-32-v1.0');
    expect(res.pendingJobsCount).toBe(1);
  });

  it('ML-008: should retrieve and update Active Learning configuration', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        value: JSON.stringify({
          uncertaintyMargin: 'Top-1 Conf - Top-2 Conf < 0.20',
          minSamplesForAutoRetrain: 100,
        }),
      },
    ]);

    const cfg = await adminService.getActiveLearningConfig();
    expect(cfg.minSamplesForAutoRetrain).toBe(100);

    // Now update
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          value: JSON.stringify({
            uncertaintyMargin: 'Top-1 Conf - Top-2 Conf < 0.20',
            minSamplesForAutoRetrain: 100,
          }),
        },
      ]) // getActiveLearningConfig inside update
      .mockResolvedValueOnce([]) // upsert
      .mockResolvedValueOnce([]); // audit log

    const updateDto: ActiveLearningConfigDto = {
      minSamplesForAutoRetrain: 150,
      defaultTopK: 75,
    };

    const updated = await adminService.updateActiveLearningConfig(updateDto, 'admin-1');
    expect(updated.minSamplesForAutoRetrain).toBe(150);
    expect(updated.defaultTopK).toBe(75);
  });

  it('ML-009: AdminController & MlopsController endpoints integration', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ cnt: 60 }]) // count check
      .mockResolvedValueOnce([{ id: 'job-99', model_type: 'YOLO12', started_at: new Date() }])
      .mockResolvedValueOnce([]);

    const req = { ip: '127.0.0.1', headers: {} };
    const adminRes = await adminController.triggerModelRetraining(
      { modelType: 'YOLO12' },
      { id: 'admin-1' },
    );
    expect(adminRes.id).toBe('job-99');

    mockDataSource.query
      .mockResolvedValueOnce([{ version_tag: 'v1' }])
      .mockResolvedValueOnce([{ version_tag: 'v2' }])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([]);

    const pipeStatus = await mlopsController.getPipelineStatus();
    expect(pipeStatus.status).toBe('HEALTHY');
  });
});
