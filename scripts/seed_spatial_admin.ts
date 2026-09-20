/**
 * Data Seeder for Vietnamese 2-Tier Administrative Boundaries & OSM Road Network
 * Official Reference: Quyết định 19/2025/QĐ-TTg
 * Geographic Data Source: https://vnsdi.mae.gov.vn/
 */

import { Client } from 'pg';

const PROVINCES_DATA = [
  { code: '01', name: 'Thành phố Hà Nội', type: 'MUNICIPALITY' },
  { code: '79', name: 'Thành phố Hồ Chí Minh', type: 'MUNICIPALITY' },
  { code: '48', name: 'Thành phố Đà Nẵng', type: 'MUNICIPALITY' },
  { code: '31', name: 'Thành phố Hải Phòng', type: 'MUNICIPALITY' },
  { code: '92', name: 'Thành phố Cần Thơ', type: 'MUNICIPALITY' },
  { code: '26', name: 'Tỉnh Vĩnh Phúc', type: 'PROVINCE' },
  { code: '27', name: 'Tỉnh Bắc Ninh', type: 'PROVINCE' },
  { code: '30', name: 'Tỉnh Hải Dương', type: 'PROVINCE' },
  { code: '33', name: 'Tỉnh Hưng Yên', type: 'PROVINCE' },
  { code: '34', name: 'Tỉnh Thái Bình', type: 'PROVINCE' },
  { code: '35', name: 'Tỉnh Hà Nam', type: 'PROVINCE' },
  { code: '36', name: 'Tỉnh Nam Định', type: 'PROVINCE' },
  { code: '37', name: 'Tỉnh Ninh Bình', type: 'PROVINCE' },
  { code: '38', name: 'Tỉnh Thanh Hóa', type: 'PROVINCE' },
  { code: '40', name: 'Tỉnh Nghệ An', type: 'PROVINCE' },
  { code: '42', name: 'Tỉnh Hà Tĩnh', type: 'PROVINCE' },
  { code: '44', name: 'Tỉnh Quảng Bình', type: 'PROVINCE' },
  { code: '45', name: 'Tỉnh Quảng Trị', type: 'PROVINCE' },
  { code: '46', name: 'Tỉnh Thừa Thiên Huế', type: 'PROVINCE' },
  { code: '49', name: 'Tỉnh Quảng Nam', type: 'PROVINCE' },
  { code: '51', name: 'Tỉnh Quảng Ngãi', type: 'PROVINCE' },
  { code: '52', name: 'Tỉnh Bình Định', type: 'PROVINCE' },
  { code: '54', name: 'Tỉnh Phú Yên', type: 'PROVINCE' },
  { code: '56', name: 'Tỉnh Khánh Hòa', type: 'PROVINCE' },
  { code: '58', name: 'Tỉnh Ninh Thuận', type: 'PROVINCE' },
  { code: '60', name: 'Tỉnh Bình Thuận', type: 'PROVINCE' },
  { code: '74', name: 'Tỉnh Bình Phước', type: 'PROVINCE' },
  { code: '75', name: 'Tỉnh Đồng Nai', type: 'PROVINCE' },
  { code: '77', name: 'Tỉnh Bà Rịa - Vũng Tàu', type: 'PROVINCE' },
  { code: '80', name: 'Tỉnh Long An', type: 'PROVINCE' },
  { code: '82', name: 'Tỉnh Tiền Giang', type: 'PROVINCE' },
  { code: '83', name: 'Tỉnh Bến Tre', type: 'PROVINCE' },
  { code: '84', name: 'Tỉnh Trà Vinh', type: 'PROVINCE' },
  { code: '86', name: 'Tỉnh Vĩnh Long', type: 'PROVINCE' },
];

async function runSeed() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.POSTGRES_USER || 'stm_user'}:${
        process.env.POSTGRES_PASSWORD || 'stm_password'
      }@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${
        process.env.POSTGRES_DB || 'signtrustmap'
      }`,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database.');

    // 1. Ensure extensions and tables exist
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // 2. Seed Provinces
    console.log('Seeding 34 administrative provinces...');
    for (const p of PROVINCES_DATA) {
      await client.query(
        `INSERT INTO admin_provinces (code, name, type)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type;`,
        [p.code, p.name, p.type],
      );
    }

    // 3. Backfill missing verified sign addresses
    console.log('Backfilling verified signs with canonical addresses...');
    const result = await client.query(`
      UPDATE verified_traffic_signs v
      SET
        commune_code = sub.commune_code,
        road_name = COALESCE(v.road_name, sub.road_name),
        display_address = CASE
          WHEN sub.road_name IS NOT NULL THEN sub.road_name || ', ' || sub.commune_name || ', ' || sub.province_name
          ELSE sub.commune_name || ', ' || sub.province_name
        END
      FROM (
        SELECT
          v2.id AS sign_id,
          c.code AS commune_code,
          c.name AS commune_name,
          p.name AS province_name,
          (
            SELECT r.name
            FROM osm_roads r
            WHERE r.name IS NOT NULL
            ORDER BY r.geometry <-> v2.location
            LIMIT 1
          ) AS road_name
        FROM verified_traffic_signs v2
        JOIN admin_communes c ON ST_Intersects(c.geometry, v2.location)
        JOIN admin_provinces p ON c.province_code = p.code
      ) sub
      WHERE v.id = sub.sign_id AND v.commune_code IS NULL;
    `);

    console.log(`Backfilled ${result.rowCount} signs.`);
    console.log('Seeding completed successfully.');
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
