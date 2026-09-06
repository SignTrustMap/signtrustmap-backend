import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WalletService } from '../../wallet/application/wallet.service';
import {
  MediaFileType,
  SubmissionMediaFile,
} from '../infrastructure/persistence/submission-media-file.entity';
import {
  SubmissionStatus,
  SubmissionType,
  SurveySubmission,
} from '../infrastructure/persistence/survey-submission.entity';
import { UploadChunk } from '../infrastructure/persistence/upload-chunk.entity';
import { UploadSession, UploadStatus } from '../infrastructure/persistence/upload-session.entity';
import { SurveyService } from './survey.service';

describe('SurveyService completeUpload', () => {
  const userId = '2ee380f2-919b-44de-9d70-595015920a60';
  const sessionId = 'bd95a9a3-3a53-48ee-8e78-c30c0fd7c646';
  const checksum = 'a'.repeat(64);

  let session: UploadSession;
  let chunks: UploadChunk[];
  let manager: jest.Mocked<EntityManager>;
  let storage: jest.Mocked<MinioStorageService>;
  let service: SurveyService;

  beforeEach(() => {
    session = {
      id: sessionId,
      userId,
      originalFilename: 'road-sign.jpg',
      mediaType: MediaFileType.IMAGE,
      totalSizeBytes: '12',
      totalChunks: 2,
      receivedChunks: 2,
      checksumExpected: checksum,
      storageKey: null,
      status: UploadStatus.UPLOADING,
      submissionId: null,
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
        return null;
      }),
      find: jest.fn(async () => chunks),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn(async (entity: unknown, value: any) => {
        if (entity === SurveySubmission) return { ...value, id: 'submission-id' };
        if (entity === SubmissionMediaFile) return { ...value, id: 'media-id' };
        return value;
      }),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EntityManager>;

    storage = {
      bucketForMediaType: jest.fn().mockReturnValue('stm-sign-crops'),
      assembleObjects: jest.fn().mockResolvedValue({ checksum, sizeBytes: 12 }),
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
      removeObjects: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MinioStorageService>;

    const dataSource = {
      transaction: jest.fn(async (work: (entityManager: EntityManager) => unknown) => work(manager)),
    } as unknown as DataSource;

    service = new SurveyService(
      {} as Repository<UploadSession>,
      {} as Repository<UploadChunk>,
      {} as Repository<SurveySubmission>,
      storage,
      dataSource,
      {} as WalletService,
      {} as NotificationsService,
    );
  });

  it('assembles all chunks and atomically persists a queued image submission', async () => {
    const result = await service.completeUpload(userId, sessionId);

    expect(storage.assembleObjects).toHaveBeenCalledWith(
      {
        bucket: 'stm-sign-crops',
        objectName: `uploads/${userId}/${sessionId}/road-sign.jpg`,
      },
      [
        {
          bucket: 'stm-sign-crops',
          objectName: `chunks/${userId}/${sessionId}/000000`,
        },
        {
          bucket: 'stm-sign-crops',
          objectName: `chunks/${userId}/${sessionId}/000001`,
        },
      ],
      12,
      'image/jpeg',
    );
    expect(manager.create).toHaveBeenCalledWith(
      SurveySubmission,
      expect.objectContaining({
        status: SubmissionStatus.QUEUED,
        submissionType: SubmissionType.SINGLE_IMAGE,
        surveyorId: userId,
      }),
    );
    expect(manager.create).toHaveBeenCalledWith(
      SubmissionMediaFile,
      expect.objectContaining({
        checksum,
        fileSizeBytes: '12',
        mediaType: MediaFileType.IMAGE,
        submissionId: 'submission-id',
      }),
    );
    expect(session.status).toBe(UploadStatus.COMPLETED);
    expect(session.submissionId).toBe('submission-id');
    expect(result).toMatchObject({
      mediaFileId: 'media-id',
      status: UploadStatus.COMPLETED,
      submissionId: 'submission-id',
    });
    expect(storage.removeObjects).toHaveBeenCalledTimes(1);
  });

  it('rejects completion until every chunk is present', async () => {
    chunks = chunks.slice(0, 1);

    await expect(service.completeUpload(userId, sessionId)).rejects.toThrow(
      'Upload is incomplete: received 1 of 2 chunks',
    );
    expect(storage.assembleObjects).not.toHaveBeenCalled();
  });

  it('rejects a session owned by another user', async () => {
    await expect(service.completeUpload('other-user', sessionId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.assembleObjects).not.toHaveBeenCalled();
  });

  it('removes the assembled object when its checksum is invalid', async () => {
    storage.assembleObjects.mockResolvedValue({ checksum: 'b'.repeat(64), sizeBytes: 12 });

    await expect(service.completeUpload(userId, sessionId)).rejects.toThrow(
      'Assembled file checksum does not match expected checksum',
    );
    expect(storage.removeObject).toHaveBeenCalledWith({
      bucket: 'stm-sign-crops',
      objectName: `uploads/${userId}/${sessionId}/road-sign.jpg`,
    });
    expect(manager.create).not.toHaveBeenCalledWith(SurveySubmission, expect.anything());
  });

  it('returns the persisted result without assembling again after completion', async () => {
    session.status = UploadStatus.COMPLETED;
    session.submissionId = 'submission-id';
    session.storageKey = 'stm-sign-crops/uploads/completed.jpg';
    manager.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === UploadSession) return session;
      if (entity === SurveySubmission) {
        return {
          id: 'submission-id',
          status: SubmissionStatus.QUEUED,
        } as SurveySubmission;
      }
      if (entity === SubmissionMediaFile) {
        return {
          id: 'media-id',
          submissionId: 'submission-id',
          fileSizeBytes: '12',
          checksum,
        } as SubmissionMediaFile;
      }
      return null;
    });

    const result = await service.completeUpload(userId, sessionId);

    expect(result).toMatchObject({ mediaFileId: 'media-id', submissionId: 'submission-id' });
    expect(storage.assembleObjects).not.toHaveBeenCalled();
    expect(storage.removeObjects).not.toHaveBeenCalled();
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
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(session),
    } as unknown as Repository<UploadSession>;
    const chunkRepository = {
      count: jest.fn().mockResolvedValue(1),
      findOne: jest.fn().mockResolvedValue(existingChunk),
    } as unknown as Repository<UploadChunk>;
    const retryService = new SurveyService(
      sessionRepository,
      chunkRepository,
      {} as Repository<SurveySubmission>,
      storage,
      {} as DataSource,
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

    expect(result).toMatchObject({ readyToComplete: true, receivedChunks: 1 });
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
