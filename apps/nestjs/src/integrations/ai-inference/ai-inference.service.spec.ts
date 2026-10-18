import { ConfigService } from '@nestjs/config';
import { AiInferenceService } from './ai-inference.service';

describe('AiInferenceService', () => {
  let service: AiInferenceService;
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = global.fetch;
    const config = {
      get: jest.fn().mockReturnValue({
        baseUrl: 'https://ai.signmap.site',
        timeoutMs: 1000,
        internalToken: 'test-ai-token',
      }),
    };
    service = new AiInferenceService(config as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('classifyEarly', () => {
    it('returns classification result with top1 and top5 parsed from AI response', async () => {
      const mockAiResponse = {
        status: 'success',
        class_id: 102,
        class_name: 'P.102',
        confidence: 0.985,
        detect_confidence: 0.99,
        classify_confidence: 0.985,
        category: 'PROHIBITORY',
        name_vi: 'Cấm đi ngược chiều',
        standard_code: 'P.102',
        top1: {
          class_id: 102,
          class_name: 'P.102',
          confidence: 0.985,
          classify_confidence: 0.985,
          standard_code: 'P.102',
          name_vi: 'Cấm đi ngược chiều',
        },
        top5: [
          { class_id: 102, class_name: 'P.102', confidence: 0.985, classify_confidence: 0.985, standard_code: 'P.102', name_vi: 'Cấm đi ngược chiều' },
          { class_id: 130, class_name: 'P.130', confidence: 0.008, classify_confidence: 0.008, standard_code: 'P.130', name_vi: 'Cấm dừng xe và đỗ xe' },
          { class_id: 131, class_name: 'P.131a', confidence: 0.004, classify_confidence: 0.004, standard_code: 'P.131a', name_vi: 'Cấm đỗ xe' },
          { class_id: 123, class_name: 'P.123a', confidence: 0.002, classify_confidence: 0.002, standard_code: 'P.123a', name_vi: 'Cấm rẽ trái' },
          { class_id: 124, class_name: 'P.124a', confidence: 0.001, classify_confidence: 0.001, standard_code: 'P.124a', name_vi: 'Cấm quay đầu xe' },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockAiResponse),
      });

      const res = await service.classifyEarly({
        mediaUrl: 'https://s3.signmap.site/stm-sign-crops/test.jpg',
        signId: 'candidate-1',
      });

      expect(res).not.toBeNull();
      expect(res?.status).toBe('success');
      expect(res?.top1?.standardCode).toBe('P.102');
      expect(res?.top5).toHaveLength(5);
      expect(res?.top5?.[0].standardCode).toBe('P.102');
      expect(res?.top5?.[0].confidence).toBe(0.985);
      expect(res?.top5?.[1].standardCode).toBe('P.130');
      expect(res?.top5?.[4].standardCode).toBe('P.124a');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://ai.signmap.site/api/v1/inference/early-classification',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Internal-Token': 'test-ai-token',
          }),
        }),
      );
    });

    it('falls back to signs[0].top5 if top-level top5 is missing', async () => {
      const mockNestedResponse = {
        status: 'success',
        signs: [
          {
            top1: { class_id: 201, standard_code: 'W.201a', confidence: 0.91 },
            top5: [
              { class_id: 201, standard_code: 'W.201a', confidence: 0.91 },
              { class_id: 202, standard_code: 'W.202a', confidence: 0.05 },
            ],
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockNestedResponse),
      });

      const res = await service.classifyEarly({ mediaUrl: 'https://test/crop.jpg' });
      expect(res?.top1?.standardCode).toBe('W.201a');
      expect(res?.top5).toHaveLength(2);
      expect(res?.top5?.[0].classId).toBe(201);
    });

    it('returns null when AI server returns non-200', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue('Service Unavailable'),
      });

      const res = await service.classifyEarly({ mediaUrl: 'https://test/crop.jpg' });
      expect(res).toBeNull();
    });

    it('returns null when fetch throws network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connect timeout'));

      const res = await service.classifyEarly({ mediaUrl: 'https://test/crop.jpg' });
      expect(res).toBeNull();
    });
  });
});
