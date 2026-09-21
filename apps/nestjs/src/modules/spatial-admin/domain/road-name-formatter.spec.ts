import {
  formatCanonicalRoadName,
  isCleanVietnameseRoadName,
} from './road-name-formatter';

describe('formatCanonicalRoadName', () => {
  it('adds "Đường " prefix to naked road names', () => {
    expect(formatCanonicalRoadName('Nguyễn Hữu Cảnh')).toBe('Đường Nguyễn Hữu Cảnh');
    expect(formatCanonicalRoadName('Nguyễn Văn Linh')).toBe('Đường Nguyễn Văn Linh');
    expect(formatCanonicalRoadName('Trần Quốc Hoàn')).toBe('Đường Trần Quốc Hoàn');
  });

  it('preserves existing recognized infrastructure prefixes', () => {
    expect(formatCanonicalRoadName('Đường Nguyễn Huệ')).toBe('Đường Nguyễn Huệ');
    expect(formatCanonicalRoadName('Cầu Tân Thuận 2')).toBe('Cầu Tân Thuận 2');
    expect(formatCanonicalRoadName('Xa lộ Hà Nội')).toBe('Xa lộ Hà Nội');
    expect(formatCanonicalRoadName('Đại lộ Mai Chí Thọ')).toBe('Đại lộ Mai Chí Thọ');
    expect(formatCanonicalRoadName('Hầm Thủ Thiêm')).toBe('Hầm Thủ Thiêm');
    expect(formatCanonicalRoadName('Quốc lộ 1A')).toBe('Quốc lộ 1A');
    expect(formatCanonicalRoadName('Hẻm 54 Duy Tân')).toBe('Hẻm 54 Duy Tân');
    expect(formatCanonicalRoadName('Đường số 60')).toBe('Đường số 60');
  });

  it('cleans navigation direction junk from OSM', () => {
    expect(formatCanonicalRoadName('Hướng đi đường Hồng Hà')).toBe('Đường Hồng Hà');
    expect(formatCanonicalRoadName('Hướng đi Điện Biên Phủ')).toBe('Đường Điện Biên Phủ');
    expect(formatCanonicalRoadName('Lối vào Xa lộ Hà Nội')).toBe('Xa lộ Hà Nội');
  });

  it('translates English road terms', () => {
    expect(formatCanonicalRoadName('Nguyen Huu Canh Street')).toBe('Đường Nguyen Huu Canh');
    expect(formatCanonicalRoadName('Mai Chi Tho Boulevard')).toBe('Đại lộ Mai Chi Tho');
    expect(formatCanonicalRoadName('Street No. 60')).toBe('Đường số 60');
    expect(formatCanonicalRoadName('Tan Thuan 2 Bridge')).toBe('Cầu Tan Thuan 2');
  });

  it('handles null and undefined', () => {
    expect(formatCanonicalRoadName(null)).toBeNull();
    expect(formatCanonicalRoadName(undefined)).toBeNull();
    expect(formatCanonicalRoadName('')).toBeNull();
  });
});

describe('isCleanVietnameseRoadName', () => {
  it('detects unaccented Vietnamese street names', () => {
    expect(isCleanVietnameseRoadName('Đường Nguyen Huu Canh')).toBe(false);
    expect(isCleanVietnameseRoadName('Đường Phan Dinh Phung')).toBe(false);
    expect(isCleanVietnameseRoadName('Nguyen Tat Thanh')).toBe(false);
    expect(isCleanVietnameseRoadName('Hoang Van Thu')).toBe(false);
  });

  it('approves accented Vietnamese street names', () => {
    expect(isCleanVietnameseRoadName('Đường Nguyễn Hữu Cảnh')).toBe(true);
    expect(isCleanVietnameseRoadName('Đường Phan Đình Phùng')).toBe(true);
    expect(isCleanVietnameseRoadName('Cầu Tân Thuận 2')).toBe(true);
    expect(isCleanVietnameseRoadName('Xa lộ Hà Nội')).toBe(true);
  });

  it('detects untranslated English words', () => {
    expect(isCleanVietnameseRoadName('Nguyen Hue Street')).toBe(false);
    expect(isCleanVietnameseRoadName('Mai Chi Tho Boulevard')).toBe(false);
  });
});
