import { SelectQueryBuilder } from 'typeorm';

/**
 * Standard TypeORM PostGIS Spatial Query Helpers.
 * Encourages structured, parameter-bound QueryBuilder usage over raw untyped strings.
 */
export class SpatialQueryHelper {
  /**
   * Applies an ST_DWithin distance filter using WGS84 coordinates (SRID 4326).
   */
  static andWhereDWithin<T>(
    qb: SelectQueryBuilder<T>,
    columnExpression: string,
    longitude: number,
    latitude: number,
    radiusMeters: number,
    paramPrefix = 'spatial',
  ): SelectQueryBuilder<T> {
    return qb.andWhere(
      `ST_DWithin(${columnExpression}::geography, ST_SetSRID(ST_MakePoint(:${paramPrefix}Lon, :${paramPrefix}Lat), 4326)::geography, :${paramPrefix}Radius)`,
      {
        [`${paramPrefix}Lon`]: longitude,
        [`${paramPrefix}Lat`]: latitude,
        [`${paramPrefix}Radius`]: radiusMeters,
      },
    );
  }

  /**
   * Selects Longitude and Latitude extracted from a PostGIS geometry column.
   */
  static addCoordinateSelects<T>(
    qb: SelectQueryBuilder<T>,
    columnExpression: string,
    aliasLon = 'longitude',
    aliasLat = 'latitude',
  ): SelectQueryBuilder<T> {
    return qb
      .addSelect(`ST_X(${columnExpression}::geometry)`, aliasLon)
      .addSelect(`ST_Y(${columnExpression}::geometry)`, aliasLat);
  }

  /**
   * Generates a PostGIS ST_SetSRID(ST_MakePoint(...)) SQL fragment with SRID 4326.
   */
  static makePointSql(lonParam: string, latParam: string): string {
    return `ST_SetSRID(ST_MakePoint(${lonParam}, ${latParam}), 4326)`;
  }
}
