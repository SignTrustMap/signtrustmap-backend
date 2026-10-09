import { Repository } from 'typeorm';
import { VerifiedSignStatus } from '../../domain/verified-sign';
import { TypeOrmVerifiedSignRepository } from './typeorm-verified-sign.repository';
import { VerifiedSignOrmEntity } from './verified-sign.orm-entity';

describe('TypeOrmVerifiedSignRepository', () => {
  it('uses a parameterized PostGIS corridor query and maps database values', async () => {
    const ormRepository = {
      query: jest.fn().mockResolvedValue([databaseRow()]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);

    const signs = await repository.findActiveAlongRoute('LINESTRING (106 10, 107 11)', 30);

    const [query, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(query).toContain('ST_DWithin');
    expect(query).toContain("sign.status = 'ACTIVE'");
    expect(query).toContain("lower(mapping.osm_key) = 'maxspeed'");
    expect(parameters).toEqual(['LINESTRING (106 10, 107 11)', 30]);
    expect(signs[0]).toMatchObject({
      id: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
      latitude: 10.7725,
      longitude: 106.698,
      trafficDirection: 90,
      freshnessScore: 0.95,
      signType: {
        id: 12,
        signCode: 'P.102',
        value: 50,
        category: { id: 2, code: 'PROHIBITORY' },
      },
    });
  });

  it('inserts a PostGIS point and reloads the created sign', async () => {
    const ormRepository = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: databaseRow().id }])
        .mockResolvedValueOnce([databaseRow()]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);
    const lastVerifiedAt = new Date('2026-08-25T00:00:00Z');

    const created = await repository.create({
      signTypeId: 12,
      originCandidateId: 'f24fc293-37c7-4c69-b2df-ece159179e2c',
      latitude: 10.7725,
      longitude: 106.698,
      trafficDirection: 90,
      signCropUrl: 'https://images.test/sign.jpg',
      lastVerifiedAt,
    });

    const [insert, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(insert).toContain('INSERT INTO verified_traffic_signs');
    expect(insert).toContain('ST_SetSRID(ST_MakePoint($3, $4), 4326)');
    expect(parameters).toEqual([
      12,
      'f24fc293-37c7-4c69-b2df-ece159179e2c',
      106.698,
      10.7725,
      90,
      'https://images.test/sign.jpg',
      lastVerifiedAt,
      null,
      null,
      null,
    ]);
    expect((ormRepository.query as jest.Mock).mock.calls[1][1]).toEqual([databaseRow().id]);
    expect(created.id).toBe(databaseRow().id);
  });

  it('uses a parameterized PostGIS bounding-box query', async () => {
    const ormRepository = {
      query: jest.fn().mockResolvedValue([databaseRow()]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);

    const signs = await repository.findActiveInBounds(10, 106, 11, 107, 200);

    const [query, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(query).toContain('ST_MakeEnvelope($1, $2, $3, $4, 4326)');
    expect(query).toContain("sign.status = 'ACTIVE'");
    expect(query).toContain('LIMIT $5');
    expect(parameters).toEqual([106, 10, 107, 11, 200]);
    expect(signs).toHaveLength(1);
  });

  it('builds a parameterized partial update and reloads the updated sign', async () => {
    const ormRepository = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: databaseRow().id }])
        .mockResolvedValueOnce([{ ...databaseRow(), status: 'STALE' }]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);

    const updated = await repository.update(databaseRow().id, {
      latitude: 10.78,
      longitude: 106.7,
      trafficDirection: null,
      status: VerifiedSignStatus.STALE,
    });

    const [update, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(update).toContain('location = ST_SetSRID(ST_MakePoint($1, $2), 4326)');
    expect(update).toContain('traffic_direction = $3');
    expect(update).toContain('status = $4::sign_lifecycle_status');
    expect(update).toContain('WHERE id = $5');
    expect(parameters).toEqual([106.7, 10.78, null, 'STALE', databaseRow().id]);
    expect(updated?.status).toBe('STALE');
  });

  it('queries nearby candidates using ST_DWithin and ST_Distance, filtering by heading when provided', async () => {
    const rowEast = { ...databaseRow(), id: 'sign-east', traffic_direction: 90, distance_meters: '15.4' };
    const rowWest = { ...databaseRow(), id: 'sign-west', traffic_direction: 270, distance_meters: '8.2' };
    const ormRepository = {
      query: jest.fn().mockResolvedValue([rowWest, rowEast]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);

    // Query without heading
    const allNearby = await repository.findNearbyCandidates(10.7725, 106.698, 20);
    expect(allNearby).toHaveLength(2);
    expect(allNearby[0].distanceMeters).toBe(8.2);
    expect(allNearby[1].distanceMeters).toBe(15.4);

    const [query, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(query).toContain('ST_DWithin');
    expect(query).toContain('ST_Distance');
    expect(parameters).toEqual([106.698, 10.7725, 20]);

    // Query with heading = 95 degrees (matches rowEast with heading 90, within 45 deg; rejects rowWest with 270)
    const headingFiltered = await repository.findNearbyCandidates(10.7725, 106.698, 20, 95);
    expect(headingFiltered).toHaveLength(1);
    expect(headingFiltered[0].sign.id).toBe('sign-east');
  });


  function databaseRow() {
    return {
      id: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
      sign_type_id: 12,
      longitude: '106.698',
      latitude: '10.7725',
      traffic_direction: '90',
      sign_crop_url: 'https://images.test/sign.jpg',
      best_frame_url: 'https://images.test/frame.jpg',
      status: 'ACTIVE',
      freshness_score: '0.95',
      last_verified_at: new Date('2026-08-25T00:00:00Z'),
      created_at: new Date('2026-08-24T00:00:00Z'),
      updated_at: new Date('2026-08-25T00:00:00Z'),
      category_id: 2,
      sign_code: 'P.102',
      name_vi: 'Cam di nguoc chieu',
      name_en: 'No entry',
      description: null,
      labeling_guidelines: null,
      shape: 'CIRCLE',
      color_scheme: 'RED_WHITE',
      is_active: true,
      navigation_value: '50 km/h',
      category_code: 'PROHIBITORY',
      category_name_vi: 'Bien cam',
      category_name_en: 'Prohibitory',
    };
  }
});
