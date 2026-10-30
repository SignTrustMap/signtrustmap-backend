import { ConfigService } from '@nestjs/config';
import { CatalogSyncService } from './catalog-sync.service';

describe('CatalogSyncService', () => {
  let service: CatalogSyncService;
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = global.fetch;
    const config = {
      get: jest.fn().mockReturnValue({
        fastapiBaseUrl: 'http://localhost:8000',
        timeoutMs: 1000,
        internalToken: 'test-token',
      }),
    };
    service = new CatalogSyncService(config as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('syncLabels', () => {
    it('returns triggered: true on 200 response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('OK'),
      });

      const res = await service.syncLabels();
      expect(res.triggered).toBe(true);
      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/catalog/sync',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Internal-Token': 'test-token' }),
        }),
      );
    });

    it('returns triggered: false on non-200 response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal error'),
      });

      const res = await service.syncLabels();
      expect(res.triggered).toBe(false);
      expect(res.status).toBe(500);
    });

    it('handles network failure gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const res = await service.syncLabels();
      expect(res.triggered).toBe(false);
      expect(res.message).toContain('Connection refused');
    });
  });

  describe('rebuildPrototypes', () => {
    it('returns triggered: true and payload on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ count: 42 }),
      });

      const res = await service.rebuildPrototypes();
      expect(res.triggered).toBe(true);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ count: 42 });
    });

    it('returns triggered: false on error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({ detail: 'No samples' }),
      });

      const res = await service.rebuildPrototypes();
      expect(res.triggered).toBe(false);
      expect(res.status).toBe(400);
      expect(res.message).toBe('No samples');
    });

    it('handles network exception gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));

      const res = await service.rebuildPrototypes();
      expect(res.triggered).toBe(false);
      expect(res.message).toContain('Timeout');
    });
  });
});
