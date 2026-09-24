# Spring data migration

These scripts migrate data from the retired Spring schema into the settled
NestJS/PostGIS schema. They do not alter application tables.

Run a read-only preflight first:

```bash
SPRING_DATABASE_URL='postgres://...' \
DATABASE_URL='postgres://...' \
./scripts/migrate-spring-data.sh --dry-run
```

Run the migration after backing up both databases:

```bash
SPRING_DATABASE_URL='postgres://...' \
DATABASE_URL='postgres://...' \
./scripts/migrate-spring-data.sh
```

The runner copies the five Spring tables into the target's isolated
`spring_legacy` schema, then transforms them in one transaction under an
advisory lock. The migration is idempotent: persistent mapping tables connect
Spring UUIDs to NestJS integer catalog IDs, and every write is an upsert or a
conflict-safe insert.

Important conversions:

- `app_user` becomes `users`; `DISABLED` becomes `SUSPENDED`.
- UUID catalog IDs are mapped to the existing integer IDs by catalog code.
- A dedicated migration user and submission own deterministic synthetic
  candidates required by `verified_traffic_signs.origin_candidate_id`.
- A missing sign image becomes `legacy://verified-sign/<source UUID>`.
- `DISPUTED` becomes `STALE`; Spring's direction enum is retained in the audit
  while `heading_degrees` becomes the target numeric traffic direction.
- OSM mappings are normalized only when they use `key=value` and both values
  fit the target columns. Other values remain available in the audit.

Inspect reconciliation and lossy conversions after every run:

```sql
SELECT entity_type, count(*)
FROM spring_legacy.migration_audit
GROUP BY entity_type
ORDER BY entity_type;

SELECT *
FROM spring_legacy.migration_audit
WHERE cardinality(warnings) > 0
ORDER BY entity_type, source_id;
```

Staged source rows and audit/mapping records are deliberately retained. Restrict
access to the `spring_legacy` schema because it contains user email addresses.
