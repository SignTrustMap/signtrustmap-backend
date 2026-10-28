import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../auth/infrastructure/persistence/user.entity';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private cache: { data: any; expiresAt: number } | null = null;
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly dataSource: DataSource) {}

  async getLeaderboard(page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(Math.max(1, pageSize), 100);
    const now = Date.now();

    // Serve from in-memory cache if fresh
    if (this.cache && this.cache.expiresAt > now) {
      const items: any[] = this.cache.data;
      const start = (p - 1) * ps;
      const sliced = items.slice(start, start + ps);
      return { items: sliced, total: items.length, page: p, pageSize: ps, totalPages: Math.ceil(items.length / ps), cached: true };
    }

    try {
      const rows: any[] = await this.dataSource.query(
        'SELECT * FROM mv_community_leaderboard ORDER BY rank ASC LIMIT 500',
      );
      this.cache = { data: rows, expiresAt: now + this.TTL_MS };
      const start = (p - 1) * ps;
      const sliced = rows.slice(start, start + ps);
      return { items: sliced, total: rows.length, page: p, pageSize: ps, totalPages: Math.ceil(rows.length / ps), cached: false };
    } catch (e: any) {
      this.logger.warn('mv_community_leaderboard query failed: ' + e?.message);
      // Fallback: compute on the fly from reviewer_profiles if view missing
      try {
        let rows: any[] = [];
        if (typeof this.dataSource?.getRepository === 'function') {
          rows = await this.dataSource
            .getRepository(User)
            .createQueryBuilder('u')
            .select([
              'u.id AS user_id',
              'u.fullName AS full_name',
              'u.avatarUrl AS avatar_url',
              'COALESCE(rp.total_reviews, 0) AS total_reviews',
              'COALESCE(rp.correct_reviews, 0) AS correct_reviews',
              'COALESCE(rp.accuracy_rate, 0) AS accuracy_rate',
              'COALESCE(rp.reliability_score, 0) AS reliability_score',
              'COALESCE(rp.current_streak, 0) AS current_streak',
              'COALESCE(sp.total_submissions, 0) AS total_submissions',
              'COALESCE(sp.total_verified_signs, 0) AS total_verified_signs',
              'COALESCE(w.balance, 0)::bigint AS current_balance',
            ])
            .leftJoin('reviewer_profiles', 'rp', 'rp.user_id = u.id')
            .leftJoin('surveyor_profiles', 'sp', 'sp.user_id = u.id')
            .leftJoin('wallets', 'w', 'w.user_id = u.id')
            .orderBy('COALESCE(rp.reliability_score, 0)', 'DESC')
            .limit(500)
            .getRawMany();
        } else {
          rows = await this.dataSource.query(
            `SELECT u.id AS user_id, u.full_name, u.avatar_url,
                    COALESCE(rp.total_reviews,0) AS total_reviews,
                    COALESCE(rp.correct_reviews,0) AS correct_reviews,
                    COALESCE(rp.accuracy_rate,0) AS accuracy_rate,
                    COALESCE(rp.reliability_score,0) AS reliability_score,
                    COALESCE(rp.current_streak,0) AS current_streak,
                    COALESCE(sp.total_submissions,0) AS total_submissions,
                    COALESCE(sp.total_verified_signs,0) AS total_verified_signs,
                    COALESCE(w.balance,0)::bigint AS current_balance
             FROM users u
             LEFT JOIN reviewer_profiles rp ON rp.user_id = u.id
             LEFT JOIN surveyor_profiles sp ON sp.user_id = u.id
             LEFT JOIN wallets w ON w.user_id = u.id
             ORDER BY COALESCE(rp.reliability_score,0) DESC LIMIT 500`,
          );
        }
        this.cache = { data: rows, expiresAt: now + this.TTL_MS };
        const start = (p - 1) * ps;
        const sliced = rows.slice(start, start + ps);
        return { items: sliced, total: rows.length, page: p, pageSize: ps, totalPages: Math.ceil(rows.length / ps), cached: false, fallback: true };
      } catch (e2: any) {
        return { items: [], total: 0, page: p, pageSize: ps, totalPages: 0, error: e2?.message };
      }
    }
  }

  async refreshMaterializedView(): Promise<{ refreshed: boolean; error?: string }> {
    try {
      await this.dataSource.query('SELECT refresh_community_leaderboard()');
      this.cache = null;
      return { refreshed: true };
    } catch (e: any) {
      try {
        await this.dataSource.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_community_leaderboard');
        this.cache = null;
        return { refreshed: true };
      } catch (e2: any) {
        return { refreshed: false, error: e2?.message ?? e?.message };
      }
    }
  }
}
