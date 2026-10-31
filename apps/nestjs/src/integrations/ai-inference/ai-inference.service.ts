import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EarlyClassificationRequest {
  mediaUrl?: string;
  bucket?: string;
  objectKey?: string;
  signId?: string;
  taskId?: string;
}

export interface TopCandidateResult {
  classId?: number | null;
  className?: string | null;
  confidence?: number;
  classifyConfidence?: number | null;
  standardCode?: string | null;
  nameVi?: string | null;
  nameEn?: string | null;
}

export type AiTopCandidate = TopCandidateResult;

export interface EarlyClassificationResult {
  status: string;
  classId?: number | null;
  className?: string | null;
  confidence?: number;
  detectConfidence?: number | null;
  classifyConfidence?: number | null;
  top1?: any;
  top5?: any[];
  allPredictions?: any[];
  category?: string | null;
  nameVi?: string | null;
  nameEn?: string | null;
  standardCode?: string | null;
  signId?: string | null;
  taskId?: string | null;
  mediaUrl?: string | null;
  top1?: TopCandidateResult | null;
  top5?: TopCandidateResult[];
  signs?: any[];
}

@Injectable()
export class AiInferenceService {
  private readonly logger = new Logger(AiInferenceService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly internalToken: string;

  constructor(config: ConfigService) {
    const cfg = config.get<{ baseUrl: string; timeoutMs: number; internalToken: string }>('aiInference') ?? ({} as any);
    this.baseUrl = (cfg.baseUrl || process.env.AI_INFERENCE_URL || 'https://ai.signmap.site').replace(/\/+$/, '');
    this.timeoutMs = cfg.timeoutMs || 30000;
    this.internalToken = cfg.internalToken || process.env.INTERNAL_TOKEN || 'stm_internal_secret_dev';
  }

  /**
   * Dispatches an early classification request to the AI server on Jetson Orin.
   * Resolves traffic sign classification, labels, and standard codes for revalidation evidence.
   */
  async classifyEarly(req: EarlyClassificationRequest): Promise<EarlyClassificationResult | null> {
    try {
      this.logger.log(
        `Dispatching early classification to AI server (${this.baseUrl}) for task=${req.taskId}, sign=${req.signId}, url=${req.mediaUrl}`,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.internalToken) {
        headers['X-Internal-Token'] = this.internalToken;
      }

      try {
        const res = await fetch(`${this.baseUrl}/api/v1/inference/early-classification`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            media_url: req.mediaUrl,
            bucket: req.bucket,
            object_key: req.objectKey,
            sign_id: req.signId,
            task_id: req.taskId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          this.logger.warn(`AI server early classification returned HTTP ${res.status}: ${errorText}`);
          return null;
        }

        const data = await res.json();
        this.logger.log(
          `AI server early classification success: class_id=${data.class_id}, class_name=${data.class_name}, confidence=${data.confidence}`,
        );

        const rawTop1 = data.top1 ?? data.signs?.[0]?.top1 ?? null;
        const rawTop5 = Array.isArray(data.top5) && data.top5.length > 0
          ? data.top5
          : (Array.isArray(data.signs?.[0]?.top5) ? data.signs[0].top5 : []);

        const mapCandidate = (item: any): TopCandidateResult => ({
          classId: item?.class_id ?? item?.classId ?? null,
          className: item?.class_name ?? item?.className ?? null,
          confidence: typeof item?.confidence === 'number' ? item.confidence : 0,
          classifyConfidence: item?.classify_confidence ?? item?.classifyConfidence ?? null,
          standardCode: item?.standard_code ?? item?.standardCode ?? null,
          nameVi: item?.name_vi ?? item?.nameVi ?? null,
          nameEn: item?.name_en ?? item?.nameEn ?? null,
        });

        return {
          status: data.status,
          classId: data.class_id,
          className: data.class_name,
          confidence: data.confidence,
          detectConfidence: data.detect_confidence,
          classifyConfidence: data.classify_confidence,
          top1: data.top1,
          top5: data.top5,
          allPredictions: data.all_predictions ?? data.allPredictions ?? [],
          category: data.category,
          nameVi: data.name_vi,
          nameEn: data.name_en,
          standardCode: data.standard_code,
          signId: data.sign_id,
          taskId: data.task_id,
          mediaUrl: data.media_url,
          signs: data.signs,
          top1: rawTop1 ? mapCandidate(rawTop1) : null,
          top5: rawTop5.map(mapCandidate),
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      this.logger.warn(`AI server early classification request failed: ${err?.message ?? err}`);
      return null;
    }
  }
}
