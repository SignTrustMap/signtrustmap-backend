import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { MinioStorageService, STM_BUCKETS } from './minio-storage.service';

describe('MinioStorageService', () => {
  let service: MinioStorageService;
  let mockMinioClient: {
    putObject: jest.Mock;
    getObject: jest.Mock;
    removeObject: jest.Mock;
    removeObjects: jest.Mock;
    presignedGetObject: jest.Mock;
    bucketExists: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'minio.endpoint') return 's3.signmap.site';
        if (key === 'minio.port') return 443;
        if (key === 'minio.useSSL') return true;
        if (key === 'minio.accessKey') return 'test-access';
        if (key === 'minio.secretKey') return 'test-secret';
        if (key === 'minio.s3Domain') return 's3.signmap.site';
        return undefined;
      }),
    };

    mockMinioClient = {
      putObject: jest.fn().mockResolvedValue({ etag: '123' }),
      getObject: jest.fn(),
      removeObject: jest.fn().mockResolvedValue(undefined),
      removeObjects: jest.fn().mockResolvedValue(undefined),
      presignedGetObject: jest.fn().mockResolvedValue('https://s3.signmap.site/signed'),
      bucketExists: jest.fn().mockResolvedValue(true),
    };

    service = new MinioStorageService(configService as unknown as ConfigService);
    (service as any).client = mockMinioClient;
  });

  describe('bucketForMediaType', () => {
    it('returns corresponding bucket for media types', () => {
      expect(service.bucketForMediaType('VIDEO')).toBe(STM_BUCKETS.VIDEO);
      expect(service.bucketForMediaType('FRAME_SEQUENCE')).toBe(STM_BUCKETS.VIDEO);
      expect(service.bucketForMediaType('GPX')).toBe(STM_BUCKETS.GPX);
      expect(service.bucketForMediaType('IMAGE')).toBe(STM_BUCKETS.IMAGE);
      expect(service.bucketForMediaType('OTHER')).toBe(STM_BUCKETS.VIDEO);
    });
  });

  describe('getPublicUrl', () => {
    it('generates public URL matching s3 domain and SSL protocol', () => {
      const url = service.getPublicUrl('stm-sign-crops', 'candidate-1.jpg');
      expect(url).toBe('https://s3.signmap.site/stm-sign-crops/candidate-1.jpg');
    });

    it('handles paths with leading or trailing slashes', () => {
      const url = service.getPublicUrl('/stm-sign-crops/', '/candidate-2.jpg');
      expect(url).toBe('https://s3.signmap.site/stm-sign-crops/candidate-2.jpg');
    });
  });

  describe('putObject', () => {
    it('delegates to client.putObject with buffer and content type', async () => {
      const buf = Buffer.from('hello');
      await service.putObject('stm-sign-crops', 'test.jpg', buf, 'image/jpeg');
      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'stm-sign-crops',
        'test.jpg',
        buf,
        5,
        { 'Content-Type': 'image/jpeg' },
      );
    });

    it('throws error when client.putObject fails', async () => {
      mockMinioClient.putObject.mockRejectedValueOnce(new Error('Bucket not found'));
      await expect(service.putObject('missing-bucket', 'file.txt', Buffer.from('x'))).rejects.toThrow(
        'Bucket not found',
      );
    });
  });

  describe('assembleObjects', () => {
    it('concatenates stream sources and hashes output', async () => {
      mockMinioClient.putObject.mockImplementation(async (bucket, obj, stream) => {
        if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
          for await (const chunk of stream) {
            void chunk;
          }
        }
        return { etag: '123' };
      });

      const stream1 = Readable.from([Buffer.from('chunk1')]);
      const stream2 = Readable.from([Buffer.from('chunk2')]);

      mockMinioClient.getObject
        .mockResolvedValueOnce(stream1)
        .mockResolvedValueOnce(stream2);

      const res = await service.assembleObjects(
        { bucket: 'dest-bucket', objectName: 'combined.mp4' },
        [
          { bucket: 'b1', objectName: 'c1' },
          { bucket: 'b2', objectName: 'c2' },
        ],
        12,
        'video/mp4',
      );

      expect(res.sizeBytes).toBe(12);
      expect(res.checksum).toBeDefined();
      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'dest-bucket',
        'combined.mp4',
        expect.any(Readable),
        12,
        { 'Content-Type': 'video/mp4' },
      );
    });
  });

  describe('removeObject & removeObjects', () => {
    it('removeObject calls client.removeObject', async () => {
      await service.removeObject({ bucket: 'b1', objectName: 'obj1' });
      expect(mockMinioClient.removeObject).toHaveBeenCalledWith('b1', 'obj1');
    });

    it('removeObjects batches by bucket and calls client.removeObjects', async () => {
      await service.removeObjects([
        { bucket: 'b1', objectName: 'obj1' },
        { bucket: 'b1', objectName: 'obj2' },
        { bucket: 'b2', objectName: 'obj3' },
      ]);
      expect(mockMinioClient.removeObjects).toHaveBeenCalledWith('b1', ['obj1', 'obj2']);
      expect(mockMinioClient.removeObjects).toHaveBeenCalledWith('b2', ['obj3']);
    });
  });

  describe('presignedGetObject & bucketExists & getClient', () => {
    it('presignedGetObject delegates to client', async () => {
      const url = await service.presignedGetObject('b1', 'obj1', 1800);
      expect(url).toBe('https://s3.signmap.site/signed');
      expect(mockMinioClient.presignedGetObject).toHaveBeenCalledWith('b1', 'obj1', 1800);
    });

    it('bucketExists delegates to client', async () => {
      const exists = await service.bucketExists('b1');
      expect(exists).toBe(true);
      expect(mockMinioClient.bucketExists).toHaveBeenCalledWith('b1');
    });

    it('getClient returns the internal client', () => {
      expect(service.getClient()).toBe(mockMinioClient);
    });
  });

  describe('getObjectBuffer', () => {
    it('buffers stream chunks into a single Buffer', async () => {
      const stream = Readable.from([Buffer.from('part1'), Buffer.from('part2')]);
      mockMinioClient.getObject.mockResolvedValueOnce(stream);

      const buf = await service.getObjectBuffer({ bucket: 'b1', objectName: 'obj1' });
      expect(buf.toString('utf8')).toBe('part1part2');
    });

    it('respects maxBytes limit and terminates early', async () => {
      const stream = Readable.from([Buffer.from('12345'), Buffer.from('67890')]);
      mockMinioClient.getObject.mockResolvedValueOnce(stream);

      const buf = await service.getObjectBuffer({ bucket: 'b1', objectName: 'obj1' }, 5);
      expect(buf.length).toBe(5);
      expect(buf.toString('utf8')).toBe('12345');
    });
  });
});
