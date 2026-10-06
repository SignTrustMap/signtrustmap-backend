import { BadRequestException } from '@nestjs/common';
import { RevalidationController } from './revalidation.controller';
import { RevalidationService } from '../application/revalidation.service';

describe('RevalidationController', () => {
  let controller: RevalidationController;
  let service: {
    listTasksInBbox: jest.Mock;
    listTasks: jest.Mock;
    getTask: jest.Mock;
    listEvidencesForTask: jest.Mock;
    submitEvidence: jest.Mock;
    finalizeTask: jest.Mock;
    voteOnEvidence: jest.Mock;
    listEvidenceQueue: jest.Mock;
    listDecisions: jest.Mock;
    triggerEarlyClassification: jest.Mock;
  };

  const mockUser = { id: 'u-user', role: 'SURVEYOR' };

  beforeEach(() => {
    service = {
      listTasksInBbox: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listTasks: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getTask: jest.fn().mockResolvedValue({ id: 'task-1' }),
      listEvidencesForTask: jest.fn().mockResolvedValue([]),
      submitEvidence: jest.fn().mockResolvedValue({ id: 'ev-1' }),
      finalizeTask: jest.fn().mockResolvedValue({ id: 'task-1', status: 'COMPLETED' }),
      voteOnEvidence: jest.fn().mockResolvedValue({ id: 'vote-1' }),
      listEvidenceQueue: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listDecisions: jest.fn().mockResolvedValue([]),
      triggerEarlyClassification: jest.fn().mockResolvedValue({ taskId: 'task-1', classification: { className: 'No_entry' } }),
    };

    controller = new RevalidationController(service as unknown as RevalidationService);
  });

  describe('listTasksInBbox', () => {
    it('validates coordinates and calls service', async () => {
      await controller.listTasksInBbox('10.0', '106.0', '11.0', '107.0', 'ACTIVE', 'HIGH', '1', '20');
      expect(service.listTasksInBbox).toHaveBeenCalledWith({
        minLat: 10.0,
        minLon: 106.0,
        maxLat: 11.0,
        maxLon: 107.0,
        status: 'ACTIVE',
        priority: 'HIGH',
        page: 1,
        pageSize: 20,
      });
    });

    it('throws BadRequestException if coordinates missing or not numbers', () => {
      expect(() => controller.listTasksInBbox(undefined, '106.0', '11.0', '107.0')).toThrow(BadRequestException);
      expect(() => controller.listTasksInBbox('invalid', '106.0', '11.0', '107.0')).toThrow(BadRequestException);
    });

    it('throws BadRequestException if coordinates out of bounds', () => {
      expect(() => controller.listTasksInBbox('-100.0', '106.0', '11.0', '107.0')).toThrow(BadRequestException);
    });

    it('allows query when all bounding box coordinates are omitted', async () => {
      await controller.listTasksInBbox(undefined, undefined, undefined, undefined, 'OPEN', 'HIGH', '1', '20');
      expect(service.listTasksInBbox).toHaveBeenCalledWith({
        minLat: undefined,
        minLon: undefined,
        maxLat: undefined,
        maxLon: undefined,
        status: 'OPEN',
        priority: 'HIGH',
        page: 1,
        pageSize: 20,
      });
    });
  });

  describe('listTasks', () => {
    it('calls service with spatial filters when lat/lon provided', async () => {
      await controller.listTasks('1', '10', 'ACTIVE', 'created_at', '10.77', '106.70', '3000');
      expect(service.listTasks).toHaveBeenCalledWith(
        1,
        10,
        'ACTIVE',
        'created_at',
        { lat: 10.77, lon: 106.70, radiusMeters: 3000 },
      );
    });

    it('calls service without spatial filters when lat/lon omitted', async () => {
      await controller.listTasks('2', '25', undefined, undefined, undefined, undefined, undefined);
      expect(service.listTasks).toHaveBeenCalledWith(2, 25, undefined, undefined, undefined);
    });
  });

  describe('task and evidence operations', () => {
    it('getTask calls service.getTask', async () => {
      const res = await controller.getTask('task-1');
      expect(res).toEqual({ id: 'task-1' });
      expect(service.getTask).toHaveBeenCalledWith('task-1');
    });

    it('listEvidences calls service.listEvidencesForTask', async () => {
      const res = await controller.listEvidences('task-1');
      expect(res).toEqual([]);
      expect(service.listEvidencesForTask).toHaveBeenCalledWith('task-1');
    });

    it('submitEvidence calls service.submitEvidence', async () => {
      const dto = { status: 'CONFIRMED' } as any;
      const file = { buffer: Buffer.from('pic') } as any;
      const res = await controller.submitEvidence('task-1', mockUser, dto, file);
      expect(res).toEqual({ id: 'ev-1' });
      expect(service.submitEvidence).toHaveBeenCalledWith('task-1', mockUser.id, dto, file);
    });

    it('finalizeTask calls service.finalizeTask', async () => {
      const res = await controller.finalizeTask('task-1', mockUser);
      expect(res).toEqual({ id: 'task-1', status: 'COMPLETED' });
      expect(service.finalizeTask).toHaveBeenCalledWith('task-1', mockUser.id);
    });

    it('vote calls service.voteOnEvidence', async () => {
      const dto = { vote: 'APPROVE' } as any;
      const res = await controller.vote('ev-1', mockUser, dto);
      expect(res).toEqual({ id: 'vote-1' });
      expect(service.voteOnEvidence).toHaveBeenCalledWith('ev-1', mockUser.id, dto);
    });

    it('evidenceQueue calls service.listEvidenceQueue', async () => {
      await controller.evidenceQueue(mockUser, '1', '10');
      expect(service.listEvidenceQueue).toHaveBeenCalledWith(mockUser.id, 1, 10);
    });

    it('listDecisions calls service.listDecisions', async () => {
      const res = await controller.listDecisions('ev-1');
      expect(res).toEqual([]);
      expect(service.listDecisions).toHaveBeenCalledWith('ev-1');
    });

    it('earlyClassify calls service.triggerEarlyClassification', async () => {
      const res = await controller.earlyClassify('task-1', { mediaUrl: 'https://s3.example.com/test.jpg' });
      expect(res).toEqual({ taskId: 'task-1', classification: { className: 'No_entry' } });
      expect(service.triggerEarlyClassification).toHaveBeenCalledWith('task-1', 'https://s3.example.com/test.jpg');
    });
  });
});
