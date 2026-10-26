# 01 — API, DTO & Schema Conventions

This guide defines the mandatory rules for writing HTTP endpoints, request bodies, query parameters, and OpenAPI schemas across **NestJS** and **FastAPI**. Following these conventions ensures automated property-based fuzzers (**Schemathesis**), API contract tests, and client SDKs function without false failures or unhandled server crashes.

---

## 1. The Strict DTO Class Rule (NestJS)

NestJS is configured globally with:
```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

### ❌ NEVER: Use Inline TypeScript Types
Inline object types are completely erased by the TypeScript compiler at build time. NestJS cannot reflect their properties at runtime, causing Swagger to generate an empty schema `{}`. Furthermore, `forbidNonWhitelisted: true` will reject any request with `400 Bad Request: property X should not exist`.

```typescript
// ❌ WRONG: Fails runtime validation & invisible to Schemathesis
@Post('places/saved')
addSaved(@Body() body: { label: string; latitude: number }) { ... }
```

### ✅ ALWAYS: Create a Dedicated Class with `class-validator` & `@nestjs/swagger`
```typescript
// ✅ CORRECT: Preserves runtime metadata & documents schema
export class AddSavedPlaceDto {
  @ApiProperty({ description: 'Place label (e.g. Home, Work)', example: 'Home' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({ description: 'Latitude coordinate (-90 to 90)', example: 10.7769, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;
}

@Post('places/saved')
addSaved(@Body() dto: AddSavedPlaceDto) { ... }
```

---

## 2. Clean Regex in `@ApiProperty()`

### ❌ NEVER: Let Raw RegExp Slashes Leak into Swagger
When `@Matches(/^[A-Za-z0-9_-]+$/)` is reflected into OpenAPI, it produces `pattern: "/^[A-Za-z0-9_-]+$/"`. In JSON Schema and OpenAPI 3.0, regex patterns **must not have leading or trailing slashes**. Fuzzers will attempt to match literal `/` characters, failing generator health checks and skipping the endpoint.

```typescript
// ❌ WRONG: Swagger outputs pattern: "/^[A-Za-z0-9_-]+$/"
@Matches(/^[A-Za-z0-9_-]+$/)
code: string;
```

### ✅ ALWAYS: Supply Clean Regex String in `@ApiProperty`
```typescript
// ✅ CORRECT: Swagger outputs pattern: "^[A-Za-z0-9_-]+$"
@ApiProperty({ pattern: '^[A-Za-z0-9_-]+$', example: 'REGULATORY' })
@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
@IsString()
@Matches(/^[A-Za-z0-9_-]+$/)
code: string;
```

---

## 3. Database Integer Constraints (FastAPI & NestJS)

PostgreSQL standard `INTEGER` columns accept values from `-2,147,483,648` to `+2,147,483,647`. Unconstrained integer inputs allow fuzzers to generate 128-bit numbers that trigger unhandled SQL driver integer overflow errors (`500 Internal Server Error`).

### In FastAPI:
```python
# ❌ WRONG: Allows numbers > 2^31 - 1, causing DB integer overflow
sign_type_id: int | None = Query(default=None)

# ✅ CORRECT: Constrains integer to PostgreSQL 32-bit limit
sign_type_id: int | None = Query(default=None, ge=1, le=2147483647, description="Filter by sign type ID")
```

### In NestJS:
```typescript
// ✅ CORRECT: Constrained DTO property
@Type(() => Number)
@IsInt()
@Min(1)
@Max(2147483647)
categoryId: number;
```

---

## 4. Realistic Geographic Coordinates (Avoid Null Island)

When defining coordinates for navigation or GIS routing:
- **Never leave coordinates unguided without examples**: Automated testers will default to `(0.0, 0.0)` in the Atlantic Ocean (Null Island), causing upstream OSRM routing services to return `502 Bad Gateway` ("OSRM routing service is unavailable").
- **Always provide examples located on valid road networks** (e.g., Ho Chi Minh City):
```typescript
@ApiProperty({ description: 'Origin latitude', example: 10.7949, minimum: -90, maximum: 90 })
originLatitude: number;

@ApiProperty({ description: 'Origin longitude', example: 106.7218, minimum: -180, maximum: 180 })
originLongitude: number;
```

---

## 5. Path Parameters Must Provide Schema Examples

In FastAPI or NestJS, path parameters pointing to existing database records or files should provide valid examples or enums so tests do not get stuck in repetitive `404 Not Found` loops:

```python
# FastAPI
@router.get("/tiles/offline/{pack_id}.pmtiles")
async def get_offline_tiles(
    pack_id: str = Path(..., description="Map pack ID", examples=["vietnam-osm"])
):
    ...
```
