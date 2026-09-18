#!/usr/bin/env node
// =============================================================================
// seed_allowed_vehicles.mjs
// Applies the Task 2 (schema) + Task 3 (data) migration for per-vehicle sign
// eligibility against the production Neon database.
//
// Groups (from AI_Agent_Routing_Implementation_Guide.md; empty = prohibition):
//   A: 3,31,32,33,34,45,46,109               => [] (banned for every vehicle)
//   B: 23,24,25,91                            => [MOTORCYCLE,BICYCLE,PEDESTRIAN]
//   C: 26                                     => [CAR,TRUCK,BUS,BICYCLE,PEDESTRIAN]
//   D: 27,28                                  => [CAR,MOTORCYCLE,BUS,BICYCLE,PEDESTRIAN]
//   E: 80                                     => [CAR,TRUCK,BUS,PEDESTRIAN]
//   F: 82                                     => [CAR,MOTORCYCLE,BICYCLE,PEDESTRIAN]
//   G: 66,74                                  => [CAR,MOTORCYCLE,TRUCK,BUS]
//   H: 106,107                                => [CAR,TRUCK,BUS]
//   I: 29                                     => [CAR,MOTORCYCLE,TRUCK,BUS,BICYCLE]
//   J: every other sign type                  => all six vehicle types
//
// Usage (from apps/nestjs so `pg` resolves):
//   $env:DATABASE_URL="postgres://user:pass@ep-xx-xx.region.aws.neon.tech/neondb?sslmode=require"
//   npm run db:seed-vehicles            # dry run (prints plan + verification)
//   npm run db:seed-vehicles -- --yes   # applies the migration + seed
//
// The script is idempotent: re-running produces identical results.
// =============================================================================
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const ALL_VEHICLES = ['CAR', 'MOTORCYCLE', 'TRUCK', 'BUS', 'BICYCLE', 'PEDESTRIAN'];

const GROUPS = [
  { ids: [3, 31, 32, 33, 34, 45, 46, 109], vehicles: [] },
  { ids: [23, 24, 25, 91], vehicles: ['MOTORCYCLE', 'BICYCLE', 'PEDESTRIAN'] },
  { ids: [26], vehicles: ['CAR', 'TRUCK', 'BUS', 'BICYCLE', 'PEDESTRIAN'] },
  { ids: [27, 28], vehicles: ['CAR', 'MOTORCYCLE', 'BUS', 'BICYCLE', 'PEDESTRIAN'] },
  { ids: [80], vehicles: ['CAR', 'TRUCK', 'BUS', 'PEDESTRIAN'] },
  { ids: [82], vehicles: ['CAR', 'MOTORCYCLE', 'BICYCLE', 'PEDESTRIAN'] },
  { ids: [66, 74], vehicles: ['CAR', 'MOTORCYCLE', 'TRUCK', 'BUS'] },
  { ids: [106, 107], vehicles: ['CAR', 'TRUCK', 'BUS'] },
  { ids: [29], vehicles: ['CAR', 'MOTORCYCLE', 'TRUCK', 'BUS', 'BICYCLE'] },
];

const MAPPED_IDS = GROUPS.flatMap((group) => group.ids);

const ADDER = `ALTER TABLE "traffic_sign_types"
  ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
    NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];`;

function updateSql(parameters) {
  const values = GROUPS.map((group, index) => {
    const idsParameter = `$${parameters.push(group.ids)}::int[]`;
    const vehiclesParameter = `$${parameters.push(group.vehicles)}::text[]`;
    return `(${idsParameter}, ${vehiclesParameter})`;
  }).join(',\n');
  return `UPDATE "traffic_sign_types" sign
SET    "allowed_vehicles" = value_rows.vehicles,
       "updated_at" = now()
FROM   (VALUES
${values}
) AS value_rows(ids, vehicles)
WHERE  sign.id = ANY(value_rows.ids);`;
}

function defaultUpdateSql(parameters) {
  const idsParameter = `$${parameters.push(MAPPED_IDS)}::int[]`;
  return `UPDATE "traffic_sign_types" sign
SET    "allowed_vehicles" =
         ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[],
       "updated_at" = now()
WHERE  NOT (sign.id = ANY(${idsParameter}));`;
}

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
  try {
    for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith('DATABASE_URL=')) {
        return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
      }
    }
  } catch (error) {
    console.error(`[seed] could not read ${envPath}: ${error.message}`);
  }
  return null;
}

async function verify(client) {
  const { rows } = await client.query(
    `SELECT id, allowed_vehicles FROM "traffic_sign_types" WHERE id = ANY($1::int[]) ORDER BY id`,
    [MAPPED_IDS],
  );
  const found = new Map(rows.map((row) => [Number(row.id), row.allowed_vehicles ?? []]));
  let mismatches = 0;
  for (const group of GROUPS) {
    for (const id of group.ids) {
      const actual = found.get(id);
      const expected = [...group.vehicles].sort();
      const equals = actual && JSON.stringify([...actual].sort()) === JSON.stringify(expected);
      if (!equals) {
        mismatches += 1;
        console.error(
          `[seed] MISMATCH id=${id} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
        );
      }
    }
  }
  const idsNotInDb = MAPPED_IDS.filter((id) => !found.has(id));
  if (idsNotInDb.length > 0) {
    console.warn(`[seed] WARNING ids not present in DB: ${idsNotInDb.join(', ')}`);
  }
  console.log(`[seed] verification: ${MAPPED_IDS.length - mismatches}/${MAPPED_IDS.length} mapped ids correct.`);
  if (idsNotInDb.length > 0) {
    console.log(`[seed] verification: ${idsNotInDb.length} mapped ids missing from DB (nothing to update).`);
  }
  return mismatches === 0;
}

async function main() {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    console.error('[seed] DATABASE_URL is not set and no apps/nestjs/.env was found.');
    process.exit(1);
  }

  const apply = process.argv.includes('--yes');
  const isNeon = /neon\.tech/i.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: isNeon || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    const dbVersion = await client.query('SELECT version()');
    console.log(`[seed] connected (mode=${apply ? 'APPLY' : 'DRY-RUN'})`);
    console.log(`[seed] db: ${dbVersion.rows[0].version.split('\n')[0].trim()}`);
    console.log(`[seed] traffic_sign_types rows: ${(await client.query('SELECT count(*)::int AS n FROM "traffic_sign_types"')).rows[0].n}`);

    const groupedParameters = [];
    const seedSql = `${updateSql(groupedParameters)}\n${defaultUpdateSql(groupedParameters)}`;

    if (apply) {
      await client.query('BEGIN');
      try {
        await client.query(ADDER);
        console.log('[seed] executed ADD COLUMN allowed_vehicles');
        const result = await client.query(seedSql, groupedParameters);
        console.log(`[seed] executed seed UPDATE (rows affected: ${result.rowCount})`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log('[seed] committed.');
    } else {
      console.log('[seed] DRY-RUN — SQL prepared (not executed). Run with --yes to apply.\n');
      console.log(ADDER);
      console.log(seedSql);
    }

    const verified = await verify(client);
    if (apply && !verified) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error.message);
  process.exit(1);
});