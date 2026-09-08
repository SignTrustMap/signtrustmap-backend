FROM postgis/postgis:16-3.4

# pgvector is not bundled in postgis/postgis image – install it
RUN apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
