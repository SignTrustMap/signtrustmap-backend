# NestJS architecture

The backend uses feature-first modules. Complex features separate application orchestration,
domain types, infrastructure adapters, and HTTP presentation. Small CRUD features may keep
controllers, services, DTOs, and entities directly under the feature directory.

Dependencies point inward: presentation calls application services, application code uses
domain types and injected adapters, and infrastructure contains TypeORM persistence and
external clients. Cross-feature workflows call services exported by the owning module rather
than reaching into another feature's repository.

TypeORM entities live with their owning feature and are registered by that feature through
`TypeOrmModule.forFeature`. The root connection uses `autoLoadEntities`, so `AppModule` does
not maintain a second global entity registry.

External systems that are not business features live under `integrations`. Database migrations
and seeds belong under `database`, while reusable framework concerns belong under `common`.
