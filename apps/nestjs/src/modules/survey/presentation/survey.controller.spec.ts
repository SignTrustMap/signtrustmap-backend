import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';
import { SurveyService } from '../application/survey.service';
import { SurveyController } from './survey.controller';
import { CoordinateSource, SubmissionType } from '../domain/submission-contract';
import { SubmissionStatus } from '../infrastructure/persistence/survey-submission.entity';
import { MediaFileType } from '../infrastructure/persistence/submission-media-file.entity';

describe('SurveyController (all 13 endpoints)', () => {
  let controller: SurveyController;
  let service: jest.Mocked<SurveyService>;

  const mockUser = { id: 'user-123', email: 'surveyor@stm.dev' };
  const mockSubmissionId = 'sub-456';
  const mockSessionId = 'sess-789';

  beforeEach(() => {
    service = {
      createSubmission: jest.fn(),
      updateSubmission: jest.fn(),
      initialize: jest.fn(),
      uploadChunk: jest.fn(),
      completeUpload: jest.fn(),
      submitSubmission: jest.fn(),
      getMySubmissions: jest.fn(),
      getMyPendingCount: jest.fn(),
      getMyStats: jest.fn(),
      getSubmissionStatus: jest.fn(),
      markCompleted: jest.fn(),
      advanceSubmissionStatus: jest.fn(),
      getSession: jest.fn(),
    } as unknown as jest.Mocked<SurveyService>;

    controller = new SurveyController(service);
  });

  it('1. createSubmission delegates to surveyService.createSubmission', async () => {
    const dto = {
      submissionType: SubmissionType.SINGLE_IMAGE,
      capturedAt: '2026-09-08T00:00:00.000Z',
      coordinateSource: CoordinateSource.DEVICE_GPS,
      note: 'test note',
    };
    const expected = { id: mockSubmissionId, status: SubmissionStatus.DRAFT };
    service.createSubmission.mockResolvedValue(expected as any);

    const result = await controller.createSubmission(mockUser, dto);
    expect(service.createSubmission).toHaveBeenCalledWith(mockUser.id, dto);
    expect(result).toBe(expected);
  });

  it('2. updateSubmission delegates to surveyService.updateSubmission', async () => {
    const dto = { note: 'updated note' };
    const expected = { id: mockSubmissionId, note: 'updated note' };
    service.updateSubmission.mockResolvedValue(expected as any);

    const result = await controller.updateSubmission(mockUser, mockSubmissionId, dto);
    expect(service.updateSubmission).toHaveBeenCalledWith(mockUser.id, mockSubmissionId, dto);
    expect(result).toBe(expected);
  });

  it('3. initialize delegates to surveyService.initialize', async () => {
    const dto = {
      originalFilename: 'sign.jpg',
      mediaType: MediaFileType.IMAGE,
      totalSizeBytes: 1000,
      totalChunks: 1,
    };
    const expected = { sessionId: mockSessionId, status: 'INITIATED' };
    service.initialize.mockResolvedValue(expected as any);

    const result = await controller.initialize(mockUser, mockSubmissionId, dto);
    expect(service.initialize).toHaveBeenCalledWith(mockUser.id, mockSubmissionId, dto);
    expect(result).toBe(expected);
  });

  it('4. uploadChunk delegates to surveyService.uploadChunk', async () => {
    const body = { chunkIndex: 0 };
    const file = { buffer: Buffer.from('abc'), size: 3 } as Express.Multer.File;
    const expected = { chunkIndex: 0, receivedChunks: 1 };
    service.uploadChunk.mockResolvedValue(expected as any);

    const result = await controller.uploadChunk(mockUser, mockSessionId, body, file);
    expect(service.uploadChunk).toHaveBeenCalledWith(mockUser.id, mockSessionId, body, file);
    expect(result).toBe(expected);
  });

  it('5. completeUpload delegates to surveyService.completeUpload', async () => {
    const expected = { sessionId: mockSessionId, status: 'COMPLETED' };
    service.completeUpload.mockResolvedValue(expected as any);

    const result = await controller.completeUpload(mockUser, mockSessionId);
    expect(service.completeUpload).toHaveBeenCalledWith(mockUser.id, mockSessionId);
    expect(result).toBe(expected);
  });

  it('6. submitSubmission delegates to surveyService.submitSubmission', async () => {
    const expected = { accepted: true, submission: { id: mockSubmissionId, status: SubmissionStatus.QUEUED } };
    service.submitSubmission.mockResolvedValue(expected as any);

    const result = await controller.submitSubmission(mockUser, mockSubmissionId);
    expect(service.submitSubmission).toHaveBeenCalledWith(mockUser.id, mockSubmissionId);
    expect(result).toBe(expected);
  });

  it('7. listMySubmissions delegates to surveyService.getMySubmissions with defaults & params', async () => {
    service.getMySubmissions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });

    await controller.listMySubmissions(mockUser);
    expect(service.getMySubmissions).toHaveBeenCalledWith(mockUser.id, 1, 20);

    await controller.listMySubmissions(mockUser, '2', '10');
    expect(service.getMySubmissions).toHaveBeenCalledWith(mockUser.id, 2, 10);
  });

  it('8. myPending delegates to surveyService.getMyPendingCount', async () => {
    const expected = { total: 5, pending: 2 };
    service.getMyPendingCount.mockResolvedValue(expected);

    const result = await controller.myPending(mockUser);
    expect(service.getMyPendingCount).toHaveBeenCalledWith(mockUser.id);
    expect(result).toBe(expected);
  });

  it('9. myStats delegates to surveyService.getMyStats', async () => {
    const expected = { userId: mockUser.id, totalSubmissions: 5, creditScore: 100 };
    service.getMyStats.mockResolvedValue(expected as any);

    const result = await controller.myStats(mockUser);
    expect(service.getMyStats).toHaveBeenCalledWith(mockUser.id);
    expect(result).toBe(expected);
  });

  it('10. getSubmissionStatus delegates to surveyService.getSubmissionStatus', async () => {
    const expected = { submission: { id: mockSubmissionId }, history: [], candidates: [] };
    service.getSubmissionStatus.mockResolvedValue(expected as any);

    const result = await controller.getSubmissionStatus(mockUser, mockSubmissionId);
    expect(service.getSubmissionStatus).toHaveBeenCalledWith(mockUser.id, mockSubmissionId);
    expect(result).toBe(expected);
  });

  it('11. markCompleted delegates to surveyService.markCompleted and has internal security guards', async () => {
    const expected = { alreadyCompleted: false, submission: { id: mockSubmissionId } };
    service.markCompleted.mockResolvedValue(expected as any);

    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller.markCompleted);
    expect(isPublic).toBe(true);

    const guards = Reflect.getMetadata('__guards__', controller.markCompleted);
    expect(guards).toEqual([InternalTokenGuard]);

    const result = await controller.markCompleted(mockSubmissionId, { note: 'done' });
    expect(service.markCompleted).toHaveBeenCalledWith(mockSubmissionId, 'done');
    expect(result).toBe(expected);
  });

  it('12. advanceStatus delegates to surveyService.advanceSubmissionStatus and has internal security guards', async () => {
    const dto = {
      status: SubmissionStatus.DETECTING,
      note: 'detecting',
      validationErrors: [],
      correctionRequirements: [],
    };
    const expected = { previousStatus: SubmissionStatus.QUEUED, newStatus: SubmissionStatus.DETECTING };
    service.advanceSubmissionStatus.mockResolvedValue(expected as any);

    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller.advanceStatus);
    expect(isPublic).toBe(true);

    const guards = Reflect.getMetadata('__guards__', controller.advanceStatus);
    expect(guards).toEqual([InternalTokenGuard]);

    const result = await controller.advanceStatus(mockSubmissionId, dto);
    expect(service.advanceSubmissionStatus).toHaveBeenCalledWith(
      mockSubmissionId,
      dto.status,
      dto.note,
      dto.validationErrors,
      dto.correctionRequirements,
    );
    expect(result).toBe(expected);
  });

  it('13. getSession delegates to surveyService.getSession', async () => {
    const expected = { session: { id: mockSessionId }, chunks: [] };
    service.getSession.mockResolvedValue(expected as any);

    const result = await controller.getSession(mockUser, mockSessionId);
    expect(service.getSession).toHaveBeenCalledWith(mockUser.id, mockSessionId);
    expect(result).toBe(expected);
  });

  it('14. guards controller endpoints with SURVEYOR and ADMIN roles', () => {
    const roles = Reflect.getMetadata('roles', SurveyController);
    expect(roles).toEqual(['SURVEYOR', 'ADMIN']);
  });
});
