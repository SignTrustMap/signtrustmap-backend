import { ModerationController } from './moderation.controller';
import { ModerationService } from '../application/moderation.service';

describe('ModerationController', () => {
  let controller: ModerationController;
  let service: {
    reportMissingType: jest.Mock;
    listMissingReports: jest.Mock;
    getMissingReport: jest.Mock;
    updateMissingReport: jest.Mock;
    approveAndCreateType: jest.Mock;
    listCases: jest.Mock;
    getCase: jest.Mock;
    resolveCase: jest.Mock;
  };

  const mockUser = { id: 'u-admin', role: 'ADMIN' };

  beforeEach(() => {
    service = {
      reportMissingType: jest.fn().mockResolvedValue({ id: 'rep-1' }),
      listMissingReports: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getMissingReport: jest.fn().mockResolvedValue({ id: 'rep-1' }),
      updateMissingReport: jest.fn().mockResolvedValue({ id: 'rep-1', status: 'IN_REVIEW' }),
      approveAndCreateType: jest.fn().mockResolvedValue({ signType: { id: 101 }, releasedCandidates: 1 }),
      listCases: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getCase: jest.fn().mockResolvedValue({ id: 'case-1' }),
      resolveCase: jest.fn().mockResolvedValue({ id: 'case-1', status: 'RESOLVED' }),
    };

    controller = new ModerationController(service as unknown as ModerationService);
  });

  it('reportMissing calls service.reportMissingType', async () => {
    const dto = { candidateId: 'c-1', description: 'Missing sign' } as any;
    const res = await controller.reportMissing(mockUser, dto);
    expect(res).toEqual({ id: 'rep-1' });
    expect(service.reportMissingType).toHaveBeenCalledWith(mockUser.id, dto);
  });

  it('listMissing parses pagination and calls service', async () => {
    await controller.listMissing('PENDING', '2', '10');
    expect(service.listMissingReports).toHaveBeenCalledWith('PENDING', 2, 10);

    await controller.listMissing(undefined, 'bad', 'invalid');
    expect(service.listMissingReports).toHaveBeenCalledWith(undefined, 1, 20);
  });

  it('getMissing calls service.getMissingReport', async () => {
    const res = await controller.getMissing('rep-1');
    expect(res).toEqual({ id: 'rep-1' });
    expect(service.getMissingReport).toHaveBeenCalledWith('rep-1');
  });

  it('updateMissing calls service.updateMissingReport', async () => {
    const dto = { status: 'IN_REVIEW', adminNotes: 'Looking into it' } as any;
    const res = await controller.updateMissing('rep-1', mockUser, dto);
    expect(res).toEqual({ id: 'rep-1', status: 'IN_REVIEW' });
    expect(service.updateMissingReport).toHaveBeenCalledWith('rep-1', mockUser.id, dto);
  });

  it('approveAndCreateType calls service.approveAndCreateType without file', async () => {
    const dto = { signCode: 'P.102', nameVi: 'Cam di nguoc chieu' } as any;
    const res = await controller.approveAndCreateType('rep-1', mockUser, dto);
    expect(res).toEqual({ signType: { id: 101 }, releasedCandidates: 1 });
    expect(service.approveAndCreateType).toHaveBeenCalledWith('rep-1', mockUser.id, dto, undefined);
  });

  it('approveAndCreateType calls service.approveAndCreateType with file', async () => {
    const dto = { signCode: 'P.102', nameVi: 'Cam di nguoc chieu' } as any;
    const mockFile = { originalname: 'p102.png', buffer: Buffer.from('test') } as any;
    const res = await controller.approveAndCreateType('rep-1', mockUser, dto, mockFile);
    expect(res).toEqual({ signType: { id: 101 }, releasedCandidates: 1 });
    expect(service.approveAndCreateType).toHaveBeenCalledWith('rep-1', mockUser.id, dto, mockFile);
  });

  it('listCases parses pagination and calls service', async () => {
    await controller.listCases('OPEN', '1', '15');
    expect(service.listCases).toHaveBeenCalledWith('OPEN', 1, 15);

    await controller.listCases(undefined, undefined, undefined);
    expect(service.listCases).toHaveBeenCalledWith(undefined, 1, 20);
  });

  it('getCase calls service.getCase', async () => {
    const res = await controller.getCase('case-1');
    expect(res).toEqual({ id: 'case-1' });
    expect(service.getCase).toHaveBeenCalledWith('case-1');
  });

  it('resolveCase calls service.resolveCase', async () => {
    const dto = { resolution: 'DISMISSED', resolutionNotes: 'False report' } as any;
    const res = await controller.resolveCase('case-1', mockUser, dto);
    expect(res).toEqual({ id: 'case-1', status: 'RESOLVED' });
    expect(service.resolveCase).toHaveBeenCalledWith('case-1', mockUser.id, dto);
  });
});
