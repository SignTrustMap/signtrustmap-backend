import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EarlyClassificationRequest {
  mediaUrl?: string;
  bucket?: string;
  objectKey?: string;
  signId?: string;
  taskId?: string;
}

export interface AiTopCandidate {
  classId?: number | null;
  className?: string | null;
  confidence?: number;
  classifyConfidence?: number | null;
  standardCode?: string | null;
  nameVi?: string | null;
}

export interface EarlyClassificationResult {
  status: string;
  classId?: number | null;
  className?: string | null;
  confidence?: number;
  detectConfidence?: number | null;
  classifyConfidence?: number | null;
  category?: string | null;
  nameVi?: string | null;
  nameEn?: string | null;
  standardCode?: string | null;
  signId?: string | null;
  taskId?: string | null;
  mediaUrl?: string | null;
  top1?: AiTopCandidate | null;
  top5?: AiTopCandidate[];
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

        return {
          status: data.status,
          classId: data.class_id,
          className: data.class_name,
          confidence: data.confidence,
          detectConfidence: data.detect_confidence,
          classifyConfidence: data.classify_confidence,
          category: data.category,
          nameVi: data.name_vi,
          nameEn: data.name_en,
          standardCode: data.standard_code,
          signId: data.sign_id,
          taskId: data.task_id,
          mediaUrl: data.media_url,
          top1: data.top1
            ? {
                classId: data.top1.class_id,
                className: data.top1.class_name,
                confidence: data.top1.confidence,
                classifyConfidence: data.top1.classify_confidence,
                standardCode: data.top1.standard_code,
                nameVi: data.top1.name_vi,
              }
            : null,
          top5: (data.top5 ?? []).map((item: any) => ({
            classId: item.class_id,
            className: item.class_name,
            confidence: item.confidence,
            classifyConfidence: item.classify_confidence,
            standardCode: item.standard_code,
            nameVi: item.name_vi,
          })),
          signs: data.signs,
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
