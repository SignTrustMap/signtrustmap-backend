import { Repository } from 'typeorm';
import { TypeOrmVerifiedSignRepository } from './typeorm-verified-sign.repository';
import { VerifiedSignOrmEntity } from './verified-sign.orm-entity';

describe('TypeOrmVerifiedSignRepository', () => {
  it('uses a parameterized PostGIS corridor query and maps database values', async () => {
    const ormRepository = {
      query: jest.fn().mockResolvedValue([
        {
          id: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
          sign_type_id: 12,
          longitude: '106.698',
          latitude: '10.7725',
          traffic_direction: '90',
          sign_crop_url: 'https://images.test/sign.jpg',
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
          category_code: 'PROHIBITORY',
          category_name_vi: 'Bien cam',
          category_name_en: 'Prohibitory',
        },
      ]),
    } as unknown as Repository<VerifiedSignOrmEntity>;
    const repository = new TypeOrmVerifiedSignRepository(ormRepository);

    const signs = await repository.findActiveAlongRoute('LINESTRING (106 10, 107 11)', 30);

    const [query, parameters] = (ormRepository.query as jest.Mock).mock.calls[0];
    expect(query).toContain('ST_DWithin');
    expect(query).toContain("sign.status = 'ACTIVE'");
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
        category: { id: 2, code: 'PROHIBITORY' },
      },
    });
  });
});
