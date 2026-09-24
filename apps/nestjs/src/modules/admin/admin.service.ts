import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
    const rows: any[] = await this.dataSource.query('SELECT v.id, v.sign_type_id, v.origin_candidate_id, ST_AsText(v.location) AS wkt, ST_AsGeoJSON(v.location)::json AS geojson, v.traffic_direction, v.sign_crop_url, v.status, v.freshness_score, v.last_verified_at, v.created_at, t.sign_code, t.name_en, t.name_vi, c.code AS category_code FROM verified_traffic_signs v JOIN traffic_sign_types t ON t.id = v.sign_type_id JOIN sign_categories c ON c.id = t.category_id ' + where + ' ORDER BY v.created_at DESC', params);
    if (format === 'geojson') return { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', geometry: r.geojson, properties: { id: r.id, signTypeId: r.sign_type_id, signCode: r.sign_code, nameEn: r.name_en, nameVi: r.name_vi, categoryCode: r.category_code, status: r.status, freshnessScore: r.freshness_score, trafficDirection: r.traffic_direction, signCropUrl: r.sign_crop_url, lastVerifiedAt: r.last_verified_at } })) };
    return rows;
  }
}
