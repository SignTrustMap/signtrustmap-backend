import {
  decodeMedia,
  parseGpx,
  validateFileSignature,
  validateGpxAndTrajectory,
} from './media-validator';
import {
  CorrectionRequirementCode,
  MediaFileType,
  SubmissionValidationCode,
} from './submission-contract';

describe('MediaValidator (Domain Logic)', () => {
  describe('validateFileSignature', () => {
    it('returns error if buffer too small', () => {
      const res = validateFileSignature(MediaFileType.IMAGE, Buffer.from([0x01, 0x02]));
      expect(res.valid).toBe(false);
      expect(res.error).toContain('too small');
    });

    it('detects JPEG format', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = validateFileSignature(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('JPEG');
    });

    it('detects PNG format', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const res = validateFileSignature(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('PNG');
    });

    it('detects WebP format', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii'),
      ]);
      const res = validateFileSignature(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('WEBP');
    });

    it('detects HEIF format', () => {
      const buf = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('heic', 'ascii'),
      ]);
      const res = validateFileSignature(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('HEIF');
    });

    it('rejects unsupported image format', () => {
      const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      const res = validateFileSignature(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('does not match any accepted image signature');
    });

    it('detects MP4 format', () => {
      const buf = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('isom', 'ascii'),
      ]);
      const res = validateFileSignature(MediaFileType.VIDEO, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('MP4');
    });

    it('detects MKV/WebM video format', () => {
      const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
      const res = validateFileSignature(MediaFileType.VIDEO, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('MKV/WEBM');
    });

    it('detects AVI video format', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('AVI ', 'ascii'),
      ]);
      const res = validateFileSignature(MediaFileType.VIDEO, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('AVI');
    });

    it('rejects invalid video format', () => {
      const buf = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22]);
      const res = validateFileSignature(MediaFileType.VIDEO, buf);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('does not match any accepted video signature');
    });

    it('detects GPX format', () => {
      const buf = Buffer.from('<?xml version="1.0"?><gpx version="1.1"></gpx>', 'utf8');
      const res = validateFileSignature(MediaFileType.GPX, buf);
      expect(res.valid).toBe(true);
      expect(res.detectedFormat).toBe('GPX');
    });

    it('rejects invalid GPX header', () => {
      const buf = Buffer.from('<?xml version="1.0"?><other></other>', 'utf8');
      const res = validateFileSignature(MediaFileType.GPX, buf);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('missing <gpx> root element');
    });

    it('detects FRAME_SEQUENCE json manifest and zip archive', () => {
      const jsonBuf = Buffer.from('{"frames": ["frame1.jpg"]}', 'utf8');
      const jsonRes = validateFileSignature(MediaFileType.FRAME_SEQUENCE, jsonBuf);
      expect(jsonRes.valid).toBe(true);
      expect(jsonRes.detectedFormat).toBe('JSON_FRAME_MANIFEST');

      const badJsonBuf = Buffer.from('{not json}', 'utf8');
      const badJsonRes = validateFileSignature(MediaFileType.FRAME_SEQUENCE, badJsonBuf);
      expect(badJsonRes.valid).toBe(false);

      const zipBuf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
      const zipRes = validateFileSignature(MediaFileType.FRAME_SEQUENCE, zipBuf);
      expect(zipRes.valid).toBe(true);
      expect(zipRes.detectedFormat).toBe('ZIP');

      const invalidBuf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(validateFileSignature(MediaFileType.FRAME_SEQUENCE, invalidBuf).valid).toBe(false);
    });

    it('returns error on unknown media type', () => {
      const res = validateFileSignature('UNKNOWN' as any, Buffer.from([1, 2, 3, 4, 5]));
      expect(res.valid).toBe(false);
    });
  });

  describe('decodeMedia', () => {
    it('returns invalid if signature check fails', () => {
      const res = decodeMedia(MediaFileType.IMAGE, Buffer.from([0, 0, 0, 0]));
      expect(res.valid).toBe(false);
    });

    it('decodes PNG buffer dimensions', () => {
      const buf = Buffer.alloc(32);
      // PNG header
      buf[0] = 0x89;
      buf[1] = 0x50;
      buf[2] = 0x4e;
      buf[3] = 0x47;
      buf[4] = 0x0d;
      buf[5] = 0x0a;
      buf[6] = 0x1a;
      buf[7] = 0x0a;
      // Length of IHDR
      buf.writeUInt32BE(13, 8);
      buf.write('IHDR', 12, 'ascii');
      buf.writeUInt32BE(1920, 16); // width
      buf.writeUInt32BE(1080, 20); // height

      const res = decodeMedia(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it('handles corrupt PNG', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const res = decodeMedia(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('PNG buffer too small');
    });

    it('decodes WebP buffer', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.alloc(4),
        Buffer.from('WEBP', 'ascii'),
        Buffer.alloc(8),
      ]);
      const res = decodeMedia(MediaFileType.IMAGE, buf);
      expect(res.valid).toBe(true);
      expect(res.dimensions).toEqual({ width: 1, height: 1 });
    });

    it('decodes GPX and frame sequences', () => {
      const gpxBuf = Buffer.from('<gpx><trkpt lat="10.5" lon="106.5"></trkpt></gpx>', 'utf8');
      expect(decodeMedia(MediaFileType.GPX, gpxBuf).valid).toBe(true);

      const invalidGpxBuf = Buffer.from('<gpx></gpx>', 'utf8');
      expect(decodeMedia(MediaFileType.GPX, invalidGpxBuf).valid).toBe(true);

      const jsonManifest = Buffer.from('{"frames":["a.jpg"]}', 'utf8');
      expect(decodeMedia(MediaFileType.FRAME_SEQUENCE, jsonManifest).valid).toBe(true);

      const emptyManifest = Buffer.from('{"frames":[]}', 'utf8');
      expect(decodeMedia(MediaFileType.FRAME_SEQUENCE, emptyManifest).valid).toBe(false);
    });
  });

  describe('parseGpx', () => {
    it('returns error if missing <gpx>', () => {
      const res = parseGpx(Buffer.from('<xml></xml>', 'utf8'));
      expect(res.valid).toBe(false);
      expect(res.error).toContain('missing root <gpx>');
    });

    it('parses track points with time and elevation', () => {
      const xml = `
        <gpx version="1.1">
          <trk>
            <trkseg>
              <trkpt lat="10.7769" lon="106.7009">
                <ele>12.5</ele>
                <time>2026-09-24T08:00:00Z</time>
              </trkpt>
              <trkpt lat="10.7775" lon="106.7015">
                <ele>13.0</ele>
                <time>2026-09-24T08:00:10Z</time>
              </trkpt>
            </trkseg>
          </trk>
        </gpx>
      `;
      const res = parseGpx(Buffer.from(xml, 'utf8'));
      expect(res.valid).toBe(true);
      expect(res.result?.points.length).toBe(2);
      expect(res.result?.points[0].lat).toBeCloseTo(10.7769);
      expect(res.result?.points[0].lon).toBeCloseTo(106.7009);
      expect(res.result?.points[0].ele).toBe(12.5);
      expect(res.result?.startTime).toEqual(new Date('2026-09-24T08:00:00Z'));
      expect(res.result?.endTime).toEqual(new Date('2026-09-24T08:00:10Z'));
    });
  });

  describe('validateGpxAndTrajectory', () => {
    it('returns error when points array is empty', () => {
      const res = validateGpxAndTrajectory({ points: [] });
      expect(res.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: SubmissionValidationCode.GPX_EMPTY_TRACK }),
        ]),
      );
      expect(res.correctionRequirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: CorrectionRequirementCode.PROVIDE_VALID_GPX }),
        ]),
      );
    });

    it('flags invalid coordinates out of range', () => {
      const res = validateGpxAndTrajectory({
        points: [{ lat: 95.0, lon: 200.0, time: new Date() }],
      });
      expect(res.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: SubmissionValidationCode.INVALID_GPS_COORDINATES }),
        ]),
      );
    });

    it('flags missing timestamps', () => {
      const res = validateGpxAndTrajectory({
        points: [{ lat: 10.5, lon: 106.5 }],
      });
      expect(res.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: SubmissionValidationCode.GPX_MISSING_TIMESTAMPS }),
        ]),
      );
    });

    it('flags timestamp mismatch when capturedAt is outside GPX window', () => {
      const t1 = new Date('2026-09-24T08:00:00Z');
      const t2 = new Date('2026-09-24T08:05:00Z');
      const farTime = new Date('2026-09-24T09:30:00Z'); // 1.5h later

      const res = validateGpxAndTrajectory(
        {
          points: [
            { lat: 10.5, lon: 106.5, time: t1 },
            { lat: 10.6, lon: 106.6, time: t2 },
          ],
          startTime: t1,
          endTime: t2,
        },
        farTime,
      );

      expect(res.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: SubmissionValidationCode.TIMESTAMP_RANGE_MISMATCH }),
        ]),
      );
    });

    it('accepts perfectly matching GPX track points and timestamp', () => {
      const t1 = new Date('2026-09-24T08:00:00Z');
      const t2 = new Date('2026-09-24T08:05:00Z');
      const captured = new Date('2026-09-24T08:02:00Z');

      const res = validateGpxAndTrajectory(
        {
          points: [
            { lat: 10.5, lon: 106.5, time: t1 },
            { lat: 10.6, lon: 106.6, time: t2 },
          ],
          startTime: t1,
          endTime: t2,
        },
        captured,
      );

      expect(res.validationErrors).toHaveLength(0);
      expect(res.correctionRequirements).toHaveLength(0);
    });
  });
});
