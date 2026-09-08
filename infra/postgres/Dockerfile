FROM postgis/postgis:16-3.4

# pgvector is not bundled in postgis/postgis image – install it
RUN apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*

COPY init-extensions.sql /docker-entrypoint-initdb.d/00-ext.sql
COPY schema/schema.postgres.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY schema/schema.addendum.sql /docker-entrypoint-initdb.d/02-addendum.sql
COPY seed-admin.sql /docker-entrypoint-initdb.d/03-seed-admin.sql
COPY migrations /migrations

