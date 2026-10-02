import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SurveyService } from '../application/survey.service';
import { SurveyController } from './survey.controller';
import { CreatePresignedUrlDto } from './dto/create-presigned-url.dto';

describe('PresignedUploadSpec (Flow 1: High-Bandwidth Telemetry)', () => {
  let surveyService: SurveyService;
  let surveyController: SurveyController;

  const mockSubmissionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockStorageService = {
    bucketForMediaType: jest.fn((type: string) => {
      if (type === 'VIDEO') return 'stm-raw-videos';
      if (type === 'GPX') return 'stm-gpx-logs';
      return 'stm-sign-crops';
    }),
    presignedPutObject: jest.fn(async (bucket: string, key: string, expiry: number) => {
      return `https://s3.signmap.site/${bucket}/${key}?X-Amz-Signature=mock&Expires=${expiry}`;
    }),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  const mockWalletService = {
    credit: jest.fn(),
  };

  const mockNotificationsService = {
    create: jest.fn(),
  };

  const mockBatchService = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    surveyService = new SurveyService(
      {} as any, // sessionRepo
      {} as any, // chunkRepo
      mockSubmissionRepo as any,
      mockStorageService as any,
      mockDataSource as any,
      mockWalletService as any,
      mockNotificationsService as any,
    );
    surveyController = new SurveyController(surveyService, mockBatchService);
  });

  it('S3-001: should generate a presigned PUT URL for dashcam VIDEO upload', async () => {
    mockSubmissionRepo.findOne.mockResolvedValue({
      id: 'sub-111',
      surveyorId: 'user-aaa',
    });

    const dto: CreatePresignedUrlDto = {
      mediaType: 'VIDEO',
      fileName: 'trip_recorder_cam0.mp4',
      contentType: 'video/mp4',
    };

    const res = await surveyService.generatePresignedUploadUrl('user-aaa', 'sub-111', dto);

    expect(res).toBeDefined();
    expect(res.bucket).toBe('stm-raw-videos');
    expect(res.objectKey).toContain('submissions/sub-111/');
    expect(res.objectKey).toContain('trip_recorder_cam0.mp4');
    expect(res.uploadUrl).toContain('https://s3.signmap.site/stm-raw-videos/submissions/sub-111/');
    expect(res.expiresIn).toBe(3600);
    expect(res.mediaType).toBe('VIDEO');
    expect(mockStorageService.presignedPutObject).toHaveBeenCalledWith(
      'stm-raw-videos',
      expect.stringContaining('submissions/sub-111/'),
      3600,
    );
  });

  it('S3-002: should generate a presigned PUT URL for GPX telemetry track', async () => {
    mockSubmissionRepo.findOne.mockResolvedValue({
      id: 'sub-222',
      surveyorId: 'user-bbb',
    });

    const dto: CreatePresignedUrlDto = {
      mediaType: 'GPX',
      fileName: 'telemetry_trace.gpx',
      contentType: 'application/gpx+xml',
    };

    const res = await surveyService.generatePresignedUploadUrl('user-bbb', 'sub-222', dto);

    expect(res.bucket).toBe('stm-gpx-logs');
    expect(res.objectKey).toContain('submissions/sub-222/');
    expect(res.objectKey).toContain('telemetry_trace.gpx');
    expect(res.mediaType).toBe('GPX');
  });

  it('S3-003: should prevent unauthorized surveyor from generating upload URL for another user draft', async () => {
    mockSubmissionRepo.findOne.mockResolvedValue({
      id: 'sub-333',
      surveyorId: 'legit-user',
    });

    const dto: CreatePresignedUrlDto = {
      mediaType: 'VIDEO',
      fileName: 'hacked.mp4',
    };

    await expect(
      surveyService.generatePresignedUploadUrl('attacker-user', 'sub-333', dto),
    ).rejects.toThrow(ForbiddenException);

    expect(mockStorageService.presignedPutObject).not.toHaveBeenCalled();
  });

  it('S3-004: should throw NotFoundException if submission does not exist', async () => {
    mockSubmissionRepo.findOne.mockResolvedValue(null);

    const dto: CreatePresignedUrlDto = {
      mediaType: 'IMAGE',
    };

    await expect(
      surveyService.generatePresignedUploadUrl('user-123', 'non-existent', dto),
    ).rejects.toThrow(NotFoundException);
  });

  it('S3-005: controller should route getPresignedUploadUrl properly', async () => {
    mockSubmissionRepo.findOne.mockResolvedValue({
      id: 'sub-ctrl-1',
      surveyorId: 'surveyor-999',
    });

    const dto: CreatePresignedUrlDto = {
      mediaType: 'VIDEO',
      fileName: 'front_camera.mp4',
    };

    const res = await surveyController.getPresignedUploadUrl(
      { id: 'surveyor-999' },
      'sub-ctrl-1',
      dto,
    );

    expect(res.bucket).toBe('stm-raw-videos');
    expect(res.objectKey).toContain('front_camera.mp4');
  });
});
