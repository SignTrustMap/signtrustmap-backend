import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WalletService } from '../../wallet/application/wallet.service';
import {
  CoordinateSource,
  CorrectionRequirementCode,
  MediaFileType,
  SUBMISSION_TYPE_CONTRACTS,
  SubmissionType,
  SubmissionValidationCode,
} from '../domain/submission-contract';
import { SubmissionMediaFile } from '../infrastructure/persistence/submission-media-file.entity';
import {
  SubmissionStatus,
  SurveySubmission,
} from '../infrastructure/persistence/survey-submission.entity';
import { UploadChunk } from '../infrastructure/persistence/upload-chunk.entity';
import { UploadSession, UploadStatus } from '../infrastructure/persistence/upload-session.entity';
import { SurveyService } from './survey.service';

describe('SurveyService submission contract', () => {
  const userId = '2ee380f2-919b-44de-9d70-595015920a60';
  const submissionId = '7bc04729-69f2-437b-91bb-4f972ae6322c';
  const sessionId = 'bd95a9a3-3a53-48ee-8e78-c30c0fd7c646';
  const checksum = 'a'.repeat(64);

  let submission: SurveySubmission;
  let session: UploadSession;
  let chunks: UploadChunk[];
  let manager: jest.Mocked<EntityManager>;
  let sessionRepo: jest.Mocked<Repository<UploadSession>>;
  let submissionRepo: jest.Mocked<Repository<SurveySubmission>>;
  let storage: jest.Mocked<MinioStorageService>;
  let dataSource: jest.Mocked<DataSource>;
  let service: SurveyService;

  beforeEach(() => {
    submission = {
      id: submissionId,
      surveyorId: userId,
      submissionType: SubmissionType.SINGLE_IMAGE,
      status: SubmissionStatus.DRAFT,
      capturedAt: new Date('2026-09-08T02:00:00.000Z'),
      coordinateSource: CoordinateSource.DEVICE_GPS,
      note: 'Northbound lane',
      validationErrors: [],
      correctionRequirements: [],
      failureReason: null,
      totalCandidatesExtracted: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    session = {
      id: sessionId,
      submissionId,
      userId,
      originalFilename: 'road-sign.jpg',
      mediaType: MediaFileType.IMAGE,
      totalSizeBytes: '12',
      totalChunks: 2,
      receivedChunks: 2,
      checksumExpected: checksum,
      storageKey: null,
      status: UploadStatus.UPLOADING,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    chunks = [
      {
        id: '1',
        sessionId,
        chunkIndex: 0,
        sizeBytes: 5,
        storageKey: `stm-sign-crops/chunks/${userId}/${sessionId}/000000`,
        checksum: null,
        uploadedAt: new Date(),
        session,
      },
      {
        id: '2',
        sessionId,
        chunkIndex: 1,
        sizeBytes: 7,
        storageKey: `stm-sign-crops/chunks/${userId}/${sessionId}/000001`,
        checksum: null,
        uploadedAt: new Date(),
        session,
      },
    ];

    manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === UploadSession) return session;
        if (entity === SurveySubmission) return submission;
        return null;
      }),
      find: jest.fn(async (entity: unknown) => (entity === UploadChunk ? chunks : [])),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === SubmissionMediaFile) return { ...value, id: 'media-id' };
        return value;
      }),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EntityManager>;

    sessionRepo = {
      create: jest.fn((value) => value as UploadSession),
      save: jest.fn(async (value) => ({ ...value, id: sessionId }) as UploadSession),
      findOne: jest.fn().mockResolvedValue(session),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<UploadSession>>;
    submissionRepo = {
      create: jest.fn((value) => value as SurveySubmission),
      save: jest.fn(async (value) => ({ ...value, id: submissionId }) as SurveySubmission),
      findOne: jest.fn().mockResolvedValue(submission),
    } as unknown as jest.Mocked<Repository<SurveySubmission>>;
    storage = {
      bucketForMediaType: jest.fn().mockReturnValue('stm-sign-crops'),
      assembleObjects: jest.fn().mockResolvedValue({ checksum, sizeBytes: 12 }),
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
      removeObjects: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MinioStorageService>;
    dataSource = {
      transaction: jest.fn(async (work: (entityManager: EntityManager) => unknown) => work(manager)),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DataSource>;

    service = new SurveyService(
      sessionRepo,
      {} as Repository<UploadChunk>,
      submissionRepo,
      storage,
      dataSource,
      {} as WalletService,
      {} as NotificationsService,
    );
  });

  it('publishes required media and coordinate sources for every submission type', () => {
    expect(SUBMISSION_TYPE_CONTRACTS).toEqual({
      SINGLE_IMAGE: {
        requiredMediaTypes: [MediaFileType.IMAGE],
        allowedCoordinateSources: [
          CoordinateSource.IMAGE_EXIF,
          CoordinateSource.DEVICE_GPS,
          CoordinateSource.MANUAL,
        ],
      },
      VIDEO_GPX: {
        requiredMediaTypes: [MediaFileType.VIDEO, MediaFileType.GPX],
        allowedCoordinateSources: [CoordinateSource.GPX_FILE],
      },
      LIVE_TRIP: {
        requiredMediaTypes: [MediaFileType.VIDEO],
        allowedCoordinateSources: [CoordinateSource.LIVE_STREAM],
      },
    });
  });

  it('creates a draft before any upload session', async () => {
    const result = await service.createSubmission(userId, {
      submissionType: SubmissionType.VIDEO_GPX,
      capturedAt: '2026-09-08T02:00:00.000Z',
      coordinateSource: CoordinateSource.GPX_FILE,
      note: 'Morning survey',
    });

    expect(submissionRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      surveyorId: userId,
      status: SubmissionStatus.DRAFT,
      validationErrors: [],
      correctionRequirements: [],
    }));
    expect(result).toMatchObject({
      id: submissionId,
      requiredMediaTypes: [MediaFileType.VIDEO, MediaFileType.GPX],
    });
  });

  it('attaches an accepted media upload session to the draft', async () => {
    const result = await service.initialize(userId, submissionId, {
      originalFilename: 'sign.jpg',
      mediaType: MediaFileType.IMAGE,
      totalSizeBytes: 12,
      totalChunks: 2,
    });

    expect(sessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      userId,
      mediaType: MediaFileType.IMAGE,
    }));
    expect(result.submissionId).toBe(submissionId);
  });

  it('rejects media that is not part of the submission contract', async () => {
    await expect(service.initialize(userId, submissionId, {
      originalFilename: 'track.gpx',
      mediaType: MediaFileType.GPX,
      totalSizeBytes: 12,
      totalChunks: 1,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });

  it('assembles media into the existing submission without queueing it', async () => {
    const result = await service.completeUpload(userId, sessionId);

    expect(storage.assembleObjects).toHaveBeenCalledWith(
      {
        bucket: 'stm-sign-crops',
        objectName: `uploads/${userId}/${submissionId}/${sessionId}/road-sign.jpg`,
      },
      expect.any(Array),
      12,
      'image/jpeg',
    );
    expect(manager.create).toHaveBeenCalledWith(
      SubmissionMediaFile,
      expect.objectContaining({
        submissionId,
        uploadSessionId: sessionId,
        mediaType: MediaFileType.IMAGE,
      }),
    );
    expect(manager.create).not.toHaveBeenCalledWith(SurveySubmission, expect.anything());
    expect(result).toMatchObject({
      submissionId,
      submissionStatus: SubmissionStatus.DRAFT,
      status: UploadStatus.COMPLETED,
    });
  });

  it('returns correction requirements for missing VIDEO_GPX media', async () => {
    submission.submissionType = SubmissionType.VIDEO_GPX;
    submission.coordinateSource = CoordinateSource.GPX_FILE;
    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) {
        return [{ mediaType: MediaFileType.VIDEO }] as SubmissionMediaFile[];
      }
      return [];
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(false);
    expect(result.submission.status).toBe(SubmissionStatus.PENDING_CORRECTION);
    expect(result.submission.validationErrors).toContainEqual(expect.objectContaining({
      code: SubmissionValidationCode.MISSING_MEDIA,
      mediaType: MediaFileType.GPX,
    }));
    expect(result.submission.correctionRequirements).toContainEqual(expect.objectContaining({
      code: CorrectionRequirementCode.UPLOAD_MEDIA,
      mediaType: MediaFileType.GPX,
    }));
  });

  it('distinguishes an incomplete required upload from missing media', async () => {
    submission.submissionType = SubmissionType.LIVE_TRIP;
    submission.coordinateSource = CoordinateSource.LIVE_STREAM;
    session.mediaType = MediaFileType.VIDEO;
    session.status = UploadStatus.UPLOADING;
    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === UploadSession) return [session];
      return [];
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.submission.validationErrors).toContainEqual(expect.objectContaining({
      code: SubmissionValidationCode.INCOMPLETE_UPLOAD,
      mediaType: MediaFileType.VIDEO,
    }));
    expect(result.submission.correctionRequirements).toContainEqual(expect.objectContaining({
      code: CorrectionRequirementCode.COMPLETE_UPLOAD,
    }));
  });

  it('reports invalid coordinate source and future capture time as correctable errors', async () => {
    submission.submissionType = SubmissionType.LIVE_TRIP;
    submission.coordinateSource = CoordinateSource.GPX_FILE;
    submission.capturedAt = new Date(Date.now() + 10 * 60 * 1000);
    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) {
        return [{ mediaType: MediaFileType.VIDEO }] as SubmissionMediaFile[];
      }
      return [];
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.submission.validationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: SubmissionValidationCode.INVALID_COORDINATE_SOURCE }),
      expect.objectContaining({ code: SubmissionValidationCode.CAPTURE_TIME_IN_FUTURE }),
    ]));
    expect(result.submission.correctionRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: CorrectionRequirementCode.CHANGE_COORDINATE_SOURCE }),
      expect.objectContaining({ code: CorrectionRequirementCode.CONFIRM_CAPTURE_TIME }),
    ]));
  });

  it('queues a valid submission and clears previous correction state', async () => {
    submission.validationErrors = [{ code: 'OLD', field: 'mediaFiles', message: 'old' }];
    submission.correctionRequirements = [{ code: 'OLD', field: 'mediaFiles', message: 'old' }];
    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) {
        return [{ mediaType: MediaFileType.IMAGE }] as SubmissionMediaFile[];
      }
      return [session];
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(true);
    expect(result.submission).toMatchObject({
      status: SubmissionStatus.QUEUED,
      validationErrors: [],
      correctionRequirements: [],
    });
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('submission_status_history'), [
      submissionId,
      SubmissionStatus.DRAFT,
      SubmissionStatus.QUEUED,
      'Submission contract validated',
    ]);
  });

  it('prevents internal pipeline callbacks from bypassing draft validation', async () => {
    await expect(service.advanceSubmissionStatus(
      submissionId,
      SubmissionStatus.DETECTING,
    )).rejects.toBeInstanceOf(ConflictException);
    await expect(service.markCompleted(submissionId)).rejects.toBeInstanceOf(ConflictException);
    expect(submissionRepo.save).not.toHaveBeenCalled();
  });

  it('accepts an identical chunk retry without storing it twice', async () => {
    const fileBuffer = Buffer.from('same sign image');
    const fileChecksum = createHash('sha256').update(fileBuffer).digest('hex');
    session.totalChunks = 1;
    session.totalSizeBytes = String(fileBuffer.length);
    const existingChunk = {
      ...chunks[0],
      checksum: fileChecksum,
      sizeBytes: fileBuffer.length,
    };
    const chunkRepository = {
      count: jest.fn().mockResolvedValue(1),
      findOne: jest.fn().mockResolvedValue(existingChunk),
    } as unknown as Repository<UploadChunk>;
    const retryService = new SurveyService(
      sessionRepo,
      chunkRepository,
      submissionRepo,
      storage,
      dataSource,
      {} as WalletService,
      {} as NotificationsService,
    );

    const result = await retryService.uploadChunk(
      userId,
      sessionId,
      { chunkIndex: 0 },
      {
        buffer: fileBuffer,
        size: fileBuffer.length,
      } as Express.Multer.File,
    );

    expect(result).toMatchObject({ readyToComplete: true, receivedChunks: 1, submissionId });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('enforces total-size and chunk count limits during upload initialization', async () => {
    // Exceed max size for IMAGE (50MB)
    await expect(
      service.initialize(userId, submissionId, {
        originalFilename: 'huge.jpg',
        mediaType: MediaFileType.IMAGE,
        totalSizeBytes: 60 * 1024 * 1024,
        totalChunks: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Invalid totalSizeBytes <= 0
    await expect(
      service.initialize(userId, submissionId, {
        originalFilename: 'zero.jpg',
        mediaType: MediaFileType.IMAGE,
        totalSizeBytes: 0,
        totalChunks: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Invalid totalChunks > 5000
    await expect(
      service.initialize(userId, submissionId, {
        originalFilename: 'many_chunks.jpg',
        mediaType: MediaFileType.IMAGE,
        totalSizeBytes: 1000,
        totalChunks: 5001,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces chunk limits during uploadChunk', async () => {
    // Empty chunk (0 bytes)
    await expect(
      service.uploadChunk(
        userId,
        sessionId,
        { chunkIndex: 0 },
        { buffer: Buffer.alloc(0), size: 0 } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Chunk size exceeds 50MB limit
    await expect(
      service.uploadChunk(
        userId,
        sessionId,
        { chunkIndex: 0 },
        { buffer: Buffer.alloc(5), size: 55 * 1024 * 1024 } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Chunk size exceeds total declared size
    session.totalSizeBytes = '10';
    await expect(
      service.uploadChunk(
        userId,
        sessionId,
        { chunkIndex: 0 },
        { buffer: Buffer.alloc(20), size: 20 } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Negative chunk index
    await expect(
      service.uploadChunk(
        userId,
        sessionId,
        { chunkIndex: -1 },
        { buffer: Buffer.alloc(5), size: 5 } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists invalid file signature submission as REJECTED', async () => {
    // Corrupt / invalid magic bytes for declared IMAGE
    const fakeImage = {
      id: 'media-1',
      submissionId,
      mediaType: MediaFileType.IMAGE,
      fileUrl: 'stm-sign-crops/uploads/fake.jpg',
    } as SubmissionMediaFile;

    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) return [fakeImage];
      return [session];
    });

    storage.getObjectBuffer = jest.fn().mockResolvedValue(Buffer.from('THIS_IS_NOT_AN_IMAGE_FILE'));

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(false);
    expect(result.submission.status).toBe(SubmissionStatus.REJECTED);
    expect(result.submission.validationErrors).toContainEqual(
      expect.objectContaining({
        code: SubmissionValidationCode.INVALID_FILE_SIGNATURE,
        mediaType: MediaFileType.IMAGE,
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('submission_status_history'),
      expect.arrayContaining([SubmissionStatus.REJECTED]),
    );
  });

  it('persists empty GPX track as PENDING_CORRECTION', async () => {
    submission.submissionType = SubmissionType.VIDEO_GPX;
    submission.coordinateSource = CoordinateSource.GPX_FILE;

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const emptyGpx = Buffer.from('<?xml version="1.0"?><gpx version="1.1"><trk><name>empty</name></trk></gpx>');

    const videoMedia = {
      id: 'media-vid',
      submissionId,
      mediaType: MediaFileType.VIDEO,
      fileUrl: 'stm-raw-videos/uploads/vid.mp4',
    } as SubmissionMediaFile;

    const gpxMedia = {
      id: 'media-gpx',
      submissionId,
      mediaType: MediaFileType.GPX,
      fileUrl: 'stm-gpx-logs/uploads/track.gpx',
    } as SubmissionMediaFile;

    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) return [videoMedia, gpxMedia];
      return [session];
    });

    storage.getObjectBuffer = jest.fn().mockImplementation(async (ref: any) => {
      if (ref.bucket === 'stm-raw-videos') return mp4Header;
      return emptyGpx;
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(false);
    expect(result.submission.status).toBe(SubmissionStatus.PENDING_CORRECTION);
    expect(result.submission.validationErrors).toContainEqual(
      expect.objectContaining({
        code: SubmissionValidationCode.GPX_EMPTY_TRACK,
        mediaType: MediaFileType.GPX,
      }),
    );
  });

  it('persists out-of-bounds GPS coordinates as PENDING_CORRECTION', async () => {
    submission.submissionType = SubmissionType.VIDEO_GPX;
    submission.coordinateSource = CoordinateSource.GPX_FILE;

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const invalidGpsGpx = Buffer.from(`<?xml version="1.0"?>
      <gpx version="1.1">
        <trk><trkseg>
          <trkpt lat="999.0" lon="106.70"><time>2026-09-08T02:00:00Z</time></trkpt>
        </trkseg></trk>
      </gpx>`);

    const videoMedia = {
      id: 'media-vid',
      submissionId,
      mediaType: MediaFileType.VIDEO,
      fileUrl: 'stm-raw-videos/uploads/vid.mp4',
    } as SubmissionMediaFile;

    const gpxMedia = {
      id: 'media-gpx',
      submissionId,
      mediaType: MediaFileType.GPX,
      fileUrl: 'stm-gpx-logs/uploads/track.gpx',
    } as SubmissionMediaFile;

    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) return [videoMedia, gpxMedia];
      return [session];
    });

    storage.getObjectBuffer = jest.fn().mockImplementation(async (ref: any) => {
      if (ref.bucket === 'stm-raw-videos') return mp4Header;
      return invalidGpsGpx;
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(false);
    expect(result.submission.status).toBe(SubmissionStatus.PENDING_CORRECTION);
    expect(result.submission.validationErrors).toContainEqual(
      expect.objectContaining({
        code: SubmissionValidationCode.INVALID_GPS_COORDINATES,
        mediaType: MediaFileType.GPX,
      }),
    );
  });

  it('persists timestamp range mismatch as PENDING_CORRECTION', async () => {
    submission.submissionType = SubmissionType.VIDEO_GPX;
    submission.coordinateSource = CoordinateSource.GPX_FILE;
    submission.capturedAt = new Date('2026-09-08T02:00:00.000Z');

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    // GPX timestamps from 2020 (6 years before capturedAt)
    const mismatchedGpx = Buffer.from(`<?xml version="1.0"?>
      <gpx version="1.1">
        <trk><trkseg>
          <trkpt lat="10.77" lon="106.70"><time>2020-01-01T10:00:00Z</time></trkpt>
          <trkpt lat="10.78" lon="106.71"><time>2020-01-01T10:05:00Z</time></trkpt>
        </trkseg></trk>
      </gpx>`);

    const videoMedia = {
      id: 'media-vid',
      submissionId,
      mediaType: MediaFileType.VIDEO,
      fileUrl: 'stm-raw-videos/uploads/vid.mp4',
    } as SubmissionMediaFile;

    const gpxMedia = {
      id: 'media-gpx',
      submissionId,
      mediaType: MediaFileType.GPX,
      fileUrl: 'stm-gpx-logs/uploads/track.gpx',
    } as SubmissionMediaFile;

    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) return [videoMedia, gpxMedia];
      return [session];
    });

    storage.getObjectBuffer = jest.fn().mockImplementation(async (ref: any) => {
      if (ref.bucket === 'stm-raw-videos') return mp4Header;
      return mismatchedGpx;
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(false);
    expect(result.submission.status).toBe(SubmissionStatus.PENDING_CORRECTION);
    expect(result.submission.validationErrors).toContainEqual(
      expect.objectContaining({
        code: SubmissionValidationCode.TIMESTAMP_RANGE_MISMATCH,
        field: 'capturedAt',
      }),
    );
  });

  it('transitions valid VIDEO_GPX submission to QUEUED when media and telemetry align', async () => {
    submission.submissionType = SubmissionType.VIDEO_GPX;
    submission.coordinateSource = CoordinateSource.GPX_FILE;
    submission.capturedAt = new Date('2026-09-08T02:00:00.000Z');

    const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const validGpx = Buffer.from(`<?xml version="1.0"?>
      <gpx version="1.1">
        <trk><trkseg>
          <trkpt lat="10.77" lon="106.70"><time>2026-09-08T02:00:00Z</time></trkpt>
          <trkpt lat="10.78" lon="106.71"><time>2026-09-08T02:05:00Z</time></trkpt>
        </trkseg></trk>
      </gpx>`);

    const videoMedia = {
      id: 'media-vid',
      submissionId,
      mediaType: MediaFileType.VIDEO,
      fileUrl: 'stm-raw-videos/uploads/vid.mp4',
    } as SubmissionMediaFile;

    const gpxMedia = {
      id: 'media-gpx',
      submissionId,
      mediaType: MediaFileType.GPX,
      fileUrl: 'stm-gpx-logs/uploads/track.gpx',
    } as SubmissionMediaFile;

    manager.find.mockImplementation(async (entity: unknown) => {
      if (entity === SubmissionMediaFile) return [videoMedia, gpxMedia];
      return [session];
    });

    storage.getObjectBuffer = jest.fn().mockImplementation(async (ref: any) => {
      if (ref.bucket === 'stm-raw-videos') return mp4Header;
      return validGpx;
    });

    const result = await service.submitSubmission(userId, submissionId);

    expect(result.accepted).toBe(true);
    expect(result.submission.status).toBe(SubmissionStatus.QUEUED);
  });

  it('prevents editing or resubmitting a REJECTED submission', async () => {
    submission.status = SubmissionStatus.REJECTED;

    await expect(
      service.updateSubmission(userId, submissionId, { note: 'try editing' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.submitSubmission(userId, submissionId),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
