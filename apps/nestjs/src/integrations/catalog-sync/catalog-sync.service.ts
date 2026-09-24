import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Triggers the FastAPI AI-label synchronization after sign-type catalog
 * mutations (e.g. admin creates a new TrafficSignType from a missing-type
 * report). The FastAPI side (`POST /api/v1/catalog/sync`) reloads CLIP label
 * embeddings so newly approved signs are immediately classifiable.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly token: string;

  constructor(config: ConfigService) {
    const cfg = config.get<{ fastapiBaseUrl: string; timeoutMs: number; internalToken: string }>('catalogSync') ?? {} as any;
    this.baseUrl = cfg.fastapiBaseUrl || 'http://localhost:8000';
    this.timeoutMs = cfg.timeoutMs || 10000;
    this.token = cfg.internalToken || '';
  }

  /** Fire-and-forget best-effort ping of the FastAPI label cache (never throws). */
  async syncLabels(): Promise<{ triggered: boolean; status?: number; message?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) headers['X-Internal-Token'] = this.token;
      try {
        const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/catalog/sync`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ trigger: 'catalog_mutation' }),
          signal: controller.signal,
        });
        let message: string | undefined;
        try { message = await res.text(); } catch {}
        if (!res.ok) {
          this.logger.warn(`catalog sync returned ${res.status}: ${message ?? ''}`);
          return { triggered: false, status: res.status, message };
        }
        this.logger.log(`catalog sync triggered (status ${res.status})`);
        return { triggered: true, status: res.status, message };
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      this.logger.warn(`catalog sync unavailable: ${err?.message ?? err}`);
      return { triggered: false, message: `sync_unavailable: ${err?.message ?? err}` };
    }
  }

  /** Trigger AI service to recompute ProtoFuse prototypes from database support shots. */
  async rebuildPrototypes(): Promise<{ triggered: boolean; status?: number; data?: any; message?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) headers['X-Internal-Token'] = this.token;
      try {
        const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/active-learning/prototypes/rebuild`, {
          method: 'POST',
          headers,
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          this.logger.warn(`prototype rebuild returned ${res.status}: ${data?.detail || res.statusText}`);
          return { triggered: false, status: res.status, message: data?.detail || res.statusText };
        }
        this.logger.log(`prototype rebuild triggered successfully (status ${res.status})`);
        return { triggered: true, status: res.status, data };
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      this.logger.warn(`prototype rebuild unavailable: ${err?.message ?? err}`);
      return { triggered: false, message: `rebuild_unavailable: ${err?.message ?? err}` };
    }
  }
}