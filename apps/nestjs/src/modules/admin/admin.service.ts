import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateConsensusConfigDto, UpdateRouteMatrixDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private readonly dataSource: DataSource) {}
  async listUsers(q: { role?: string; status?: string; search?: string; page?: number; pageSize?: number }) {
    const p = Math.max(1, q.page ?? 1); const ps = Math.min(Math.max(1, q.pageSize ?? 20), 100); const offset = (p - 1) * ps;
    let where = '1=1'; const params: any[] = []; let idx = 1;
    if (q.status) { where += ' AND u.status = $' + idx++; params.push(q.status); }
    if (q.search) { where += ' AND (u.email ILIKE $' + idx + ' OR u.full_name ILIKE $' + idx + ')'; params.push('%' + q.search + '%'); idx++; }
    let roleJoin = '';
    if (q.role) { roleJoin = ' JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true JOIN roles r ON r.id = ur.role_id AND r.code = $' + idx++; params.push(q.role); }
    const countRows: any[] = await this.dataSource.query('SELECT COUNT(DISTINCT u.id)::int AS cnt FROM users u ' + roleJoin + ' WHERE ' + where, params);
    const total = countRows[0]?.cnt ?? 0;
    const rows: any[] = await this.dataSource.query(
      'SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.status, u.created_at, u.updated_at, COALESCE(json_agg(DISTINCT r2.code) FILTER (WHERE r2.code IS NOT NULL), \'[]\') AS roles FROM users u LEFT JOIN user_roles ur2 ON ur2.user_id = u.id AND ur2.is_active = true LEFT JOIN roles r2 ON r2.id = ur2.role_id ' + (q.role ? 'JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true JOIN roles r ON r.id = ur.role_id AND r.code = $' + (params.length+1) : '') + ' WHERE ' + where + ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx, q.role ? [...params, ps, offset] : [...params, ps, offset]);
    return { items: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async updateUserStatus(userId: string, newStatus: string, reason: string | undefined, changedBy: string, ip?: string) {
    const rows: any[] = await this.dataSource.query('SELECT id, status FROM users WHERE id=$1', [userId]);
    if (rows.length === 0) throw new NotFoundException('User ' + userId + ' not found');
    const oldStatus = rows[0].status;
    if (oldStatus === newStatus) throw new BadRequestException('User is already ' + newStatus);
    await this.dataSource.query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [newStatus, userId]);
    await this.dataSource.query('INSERT INTO user_status_history (user_id, old_status, new_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)', [userId, oldStatus, newStatus, reason ?? null, changedBy]);
    await this.dataSource.query("INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address) VALUES ($1,'UPDATE_USER_STATUS','users',$2,$3,$4,$5)", [changedBy, userId, JSON.stringify({ status: oldStatus }), JSON.stringify({ status: newStatus, reason }), ip ?? null]);
    return { userId, oldStatus, newStatus };
  }
  async assignRole(userId: string, roleCode: string, assignedBy: string, isActive = true) {
    const uRows: any[] = await this.dataSource.query('SELECT id FROM users WHERE id=$1', [userId]);
    if (uRows.length === 0) throw new NotFoundException('User ' + userId + ' not found');
    const rRows: any[] = await this.dataSource.query('SELECT id, code FROM roles WHERE code=$1', [roleCode]);
    if (rRows.length === 0) throw new NotFoundException('Role ' + roleCode + ' not found');
    const roleId = rRows[0].id;
    const existing: any[] = await this.dataSource.query('SELECT id, is_active FROM user_roles WHERE user_id=$1 AND role_id=$2', [userId, roleId]);
    if (existing.length > 0) await this.dataSource.query('UPDATE user_roles SET is_active=$1 WHERE user_id=$2 AND role_id=$3', [isActive, userId, roleId]);
    else await this.dataSource.query('INSERT INTO user_roles (user_id, role_id, assigned_by, is_active) VALUES ($1,$2,$3,$4)', [userId, roleId, assignedBy, isActive]);
    await this.dataSource.query("INSERT INTO audit_logs (user_id, action, resource_name, resource_id, new_values) VALUES ($1,'ASSIGN_ROLE','user_roles',$2,$3)", [assignedBy, userId, JSON.stringify({ roleCode, isActive })]);
    return { userId, roleCode, roleId, isActive };
  }
  async listAuditLogs(q: { action?: string; resourceName?: string; userId?: string; page?: number; pageSize?: number }) {
    const p = Math.max(1, q.page ?? 1); const ps = Math.min(Math.max(1, q.pageSize ?? 20), 100); const offset = (p - 1) * ps;
    const conds: string[] = []; const params: any[] = []; let idx = 1;
    if (q.action) { conds.push('action = $' + idx++); params.push(q.action); }
    if (q.resourceName) { conds.push('resource_name = $' + idx++); params.push(q.resourceName); }
    if (q.userId) { conds.push('user_id = $' + idx++); params.push(q.userId); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const countRows: any[] = await this.dataSource.query('SELECT COUNT(*)::int AS cnt FROM audit_logs ' + where, params);
    const total = countRows[0]?.cnt ?? 0;
    const rows: any[] = await this.dataSource.query('SELECT * FROM audit_logs ' + where + ' ORDER BY created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx, [...params, ps, offset]);
    return { items: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async exportSigns(format: string, status?: string) {
    const where = status ? 'WHERE v.status = $1' : '';
    const params: any[] = status ? [status] : [];
    const rows: any[] = await this.dataSource.query(
      `SELECT
         v.id,
         v.sign_type_id,
         v.origin_candidate_id,
         ST_AsText(v.location) AS wkt,
         ST_AsGeoJSON(v.location)::json AS geojson,
         ST_Y(v.location::geometry) AS lat,
         ST_X(v.location::geometry) AS lon,
         v.traffic_direction,
         v.sign_crop_url,
         v.status,
         v.freshness_score,
         v.last_verified_at,
         v.created_at,
         t.sign_code,
         t.name_en,
         t.name_vi,
         c.code AS category_code
       FROM verified_traffic_signs v
       JOIN traffic_sign_types t ON t.id = v.sign_type_id
       JOIN sign_categories c ON c.id = t.category_id
       ${where}
       ORDER BY v.created_at DESC`,
      params,
    );

    const fmt = (format || 'json').toLowerCase();

    if (fmt === 'geojson') {
      return {
        type: 'FeatureCollection',
        features: rows.map((r) => ({
          type: 'Feature',
          geometry: r.geojson,
          properties: {
            id: r.id,
            signTypeId: r.sign_type_id,
            signCode: r.sign_code,
            nameEn: r.name_en,
            nameVi: r.name_vi,
            categoryCode: r.category_code,
            status: r.status,
            freshnessScore: r.freshness_score,
            trafficDirection: r.traffic_direction,
            signCropUrl: r.sign_crop_url,
            lastVerifiedAt: r.last_verified_at,
          },
        })),
      };
    }

    if (fmt === 'csv') {
      const escapeCsv = (val: any) => {
        if (val == null) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const headers = [
        'id',
        'sign_code',
        'name_en',
        'name_vi',
        'category_code',
        'status',
        'latitude',
        'longitude',
        'traffic_direction',
        'freshness_score',
        'last_verified_at',
        'sign_crop_url',
      ];

      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push(
          [
            escapeCsv(r.id),
            escapeCsv(r.sign_code),
            escapeCsv(r.name_en),
            escapeCsv(r.name_vi),
            escapeCsv(r.category_code),
            escapeCsv(r.status),
            escapeCsv(r.lat),
            escapeCsv(r.lon),
            escapeCsv(r.traffic_direction),
            escapeCsv(r.freshness_score),
            escapeCsv(r.last_verified_at ? new Date(r.last_verified_at).toISOString() : ''),
            escapeCsv(r.sign_crop_url),
          ].join(','),
        );
      }
      return lines.join('\n');
    }

    if (fmt === 'osm') {
      const escapeXml = (val: any) => {
        if (val == null) return '';
        return String(val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const nodes = rows
        .map((r, i) => {
          const nodeId = -(i + 1);
          return `  <node id="${nodeId}" lat="${r.lat}" lon="${r.lon}" version="1">
    <tag k="traffic_sign" v="${escapeXml(r.sign_code)}"/>
    <tag k="name:en" v="${escapeXml(r.name_en)}"/>
    <tag k="name:vi" v="${escapeXml(r.name_vi)}"/>
    <tag k="traffic_sign:category" v="${escapeXml(r.category_code)}"/>
    ${r.traffic_direction != null ? `<tag k="direction" v="${escapeXml(r.traffic_direction)}"/>\n    ` : ''}<tag k="status" v="${escapeXml(r.status)}"/>
  </node>`;
        })
        .join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="SignTrustMap">\n${nodes}\n</osm>`;
    }

    return rows;
  }

  /**
   * Retrieves current active consensus config parameters
   */
  async getConsensusConfig() {
    const rows = await this.dataSource.query(
      `SELECT * FROM consensus_configs WHERE is_active = true ORDER BY effective_from DESC LIMIT 1`,
    );
    if (rows.length === 0) {
      return {
        approvalThreshold: 2.0,
        rejectionThreshold: -2.0,
        minVotesRequired: 3,
        alphaSmoothingFactor: 0.1,
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
        provisionalVoteWeight: 0.5,
        isActive: true,
      };
    }
    const c = rows[0];
    return {
      id: c.id,
      approvalThreshold: Number(c.approval_threshold),
      rejectionThreshold: Number(c.rejection_threshold),
      minVotesRequired: Number(c.min_votes_required),
      alphaSmoothingFactor: Number(c.alpha_smoothing_factor),
      weightCorrect: Number(c.weight_correct),
      penaltyFalse: Number(c.penalty_false),
      minSampleBaseline: Number(c.min_sample_baseline),
      minReliabilityThreshold: Number(c.min_reliability_threshold),
      consecutiveErrorLimit: Number(c.consecutive_error_limit),
      suspensionCooldownDays: Number(c.suspension_cooldown_days),
      provisionalVoteWeight: Number(c.provisional_vote_weight),
      createdBy: c.created_by,
      isActive: c.is_active,
      effectiveFrom: c.effective_from,
    };
  }

  /**
   * Updates consensus engine parameters, creates an audit log entry, and keeps history intact
   */
  async updateConsensusConfig(dto: UpdateConsensusConfigDto, adminUserId: string, ip?: string) {
    const current = await this.getConsensusConfig();
    const approvalThreshold = dto.approvalThreshold ?? current.approvalThreshold;
    const rejectionThreshold = dto.rejectionThreshold ?? current.rejectionThreshold;
    const minVotesRequired = dto.minVotesRequired ?? current.minVotesRequired;
    const alphaSmoothingFactor = dto.alphaSmoothingFactor ?? current.alphaSmoothingFactor;
    const weightCorrect = dto.weightCorrect ?? current.weightCorrect;
    const penaltyFalse = dto.penaltyFalse ?? current.penaltyFalse;
    const minSampleBaseline = dto.minSampleBaseline ?? current.minSampleBaseline;
    const minReliabilityThreshold = dto.minReliabilityThreshold ?? current.minReliabilityThreshold;
    const consecutiveErrorLimit = dto.consecutiveErrorLimit ?? current.consecutiveErrorLimit;
    const suspensionCooldownDays = dto.suspensionCooldownDays ?? current.suspensionCooldownDays;
    const provisionalVoteWeight = dto.provisionalVoteWeight ?? current.provisionalVoteWeight;

    // Deactivate previous active configs
    await this.dataSource.query(`UPDATE consensus_configs SET is_active = false WHERE is_active = true`);

    const result = await this.dataSource.query(
      `INSERT INTO consensus_configs (
        approval_threshold, rejection_threshold, min_votes_required, alpha_smoothing_factor,
        weight_correct, penalty_false, min_sample_baseline, min_reliability_threshold,
        consecutive_error_limit, suspension_cooldown_days, provisional_vote_weight,
        created_by, is_active, effective_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, NOW())
      RETURNING *`,
      [
        approvalThreshold,
        rejectionThreshold,
        minVotesRequired,
        alphaSmoothingFactor,
        weightCorrect,
        penaltyFalse,
        minSampleBaseline,
        minReliabilityThreshold,
        consecutiveErrorLimit,
        suspensionCooldownDays,
        provisionalVoteWeight,
        adminUserId,
      ],
    );

    const inserted = result[0];
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_CONSENSUS_CONFIG', 'consensus_configs', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(inserted.id),
        JSON.stringify(current),
        JSON.stringify({ ...dto, id: inserted.id }),
        ip ?? null,
      ],
    );

    return {
      id: inserted.id,
      approvalThreshold: Number(inserted.approval_threshold),
      rejectionThreshold: Number(inserted.rejection_threshold),
      minVotesRequired: Number(inserted.min_votes_required),
      alphaSmoothingFactor: Number(inserted.alpha_smoothing_factor),
      weightCorrect: Number(inserted.weight_correct),
      penaltyFalse: Number(inserted.penalty_false),
      minSampleBaseline: Number(inserted.min_sample_baseline),
      minReliabilityThreshold: Number(inserted.min_reliability_threshold),
      consecutiveErrorLimit: Number(inserted.consecutive_error_limit),
      suspensionCooldownDays: Number(inserted.suspension_cooldown_days),
      provisionalVoteWeight: Number(inserted.provisional_vote_weight),
      createdBy: inserted.created_by,
      isActive: inserted.is_active,
      effectiveFrom: inserted.effective_from,
    };
  }

  /**
   * Retrieves route classifications and spatial freshness decay parameters
   */
  async getRouteMatrix() {
    const rows = await this.dataSource.query(
      `SELECT id, name, road_type, default_lifetime_days, revalidation_threshold_days, spatial_buffer_meters, created_at
       FROM route_classifications
       ORDER BY id ASC`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      roadType: r.road_type,
      defaultLifetimeDays: r.default_lifetime_days,
      revalidationThresholdDays: r.revalidation_threshold_days,
      spatialBufferMeters: r.spatial_buffer_meters,
      createdAt: r.created_at,
    }));
  }

  /**
   * Updates route classification decay and spatial buffer parameters
   */
  async updateRouteMatrix(id: number, dto: UpdateRouteMatrixDto, adminUserId: string, ip?: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM route_classifications WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Route classification #${id} not found`);
    }
    const current = rows[0];

    const roadType = dto.roadType ?? current.road_type;
    const defaultLifetimeDays = dto.defaultLifetimeDays ?? current.default_lifetime_days;
    const revalidationThresholdDays = dto.revalidationThresholdDays ?? current.revalidation_threshold_days;
    const spatialBufferMeters = dto.spatialBufferMeters ?? current.spatial_buffer_meters;

    await this.dataSource.query(
      `UPDATE route_classifications
       SET road_type = $1, default_lifetime_days = $2, revalidation_threshold_days = $3, spatial_buffer_meters = $4
       WHERE id = $5`,
      [roadType, defaultLifetimeDays, revalidationThresholdDays, spatialBufferMeters, id],
    );

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_ROUTE_MATRIX', 'route_classifications', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(id),
        JSON.stringify(current),
        JSON.stringify(dto),
        ip ?? null,
      ],
    );

    return {
      id,
      name: current.name,
      roadType,
      defaultLifetimeDays,
      revalidationThresholdDays,
      spatialBufferMeters,
      updated: true,
    };
  }
}

