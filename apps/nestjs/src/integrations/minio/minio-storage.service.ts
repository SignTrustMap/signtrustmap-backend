import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as Minio from 'minio';
import { Readable } from 'stream';

export const STM_BUCKETS = {
  VIDEO: 'stm-raw-videos',
  GPX: 'stm-gpx-logs',
  IMAGE: 'stm-sign-crops',
} as const;

export type StoredObjectReference = {
  bucket: string;
  objectName: string;
};

@Injectable()
export class MinioStorageService {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: Minio.Client;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('minio.endpoint') ?? 'localhost';
    const port = this.configService.get<number>('minio.port') ?? 9000;
    const useSSL = this.configService.get<boolean>('minio.useSSL') ?? false;
    const accessKey = this.configService.get<string>('minio.accessKey') ?? 'stm_minio';
    const secretKey = this.configService.get<string>('minio.secretKey') ?? 'stm_minio_secret_123';

    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    this.logger.log(`MinIO client configured: ${endpoint}:${port} (SSL=${useSSL})`);
  }

  bucketForMediaType(mediaType: string): string {
    switch (mediaType) {
      case 'VIDEO':
        return STM_BUCKETS.VIDEO;
      case 'GPX':
        return STM_BUCKETS.GPX;
      case 'IMAGE':
        return STM_BUCKETS.IMAGE;
      default:
        return STM_BUCKETS.VIDEO;
    }
  }

  async putObject(
    bucket: string,
    objectName: string,
    buffer: Buffer,
    contentType?: string,
  ): Promise<void> {
    const meta: Record<string, string> = {};
    if (contentType) meta['Content-Type'] = contentType;

    try {
      await this.client.putObject(bucket, objectName, buffer, buffer.length, meta);
    } catch (err: any) {
      // MinIO v7 throws if bucket does not exist — surface a helpful message
      this.logger.error(`MinIO putObject failed [${bucket}/${objectName}]: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  async assembleObjects(
    destination: StoredObjectReference,
    sources: StoredObjectReference[],
    expectedSizeBytes: number,
    contentType?: string,
  ): Promise<{ checksum: string; sizeBytes: number }> {
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const client = this.client;

    async function* readSources() {
      for (const source of sources) {
        const objectStream = await client.getObject(source.bucket, source.objectName);

        for await (const data of objectStream) {
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          sizeBytes += chunk.length;
          hash.update(chunk);
          yield chunk;
        }
      }
    }

    const metadata: Record<string, string> = {};
    if (contentType) metadata['Content-Type'] = contentType;

    await this.client.putObject(
      destination.bucket,
      destination.objectName,
      Readable.from(readSources()),
      expectedSizeBytes,
      metadata,
    );

    return { checksum: hash.digest('hex'), sizeBytes };
  }

  async removeObject(reference: StoredObjectReference): Promise<void> {
    await this.client.removeObject(reference.bucket, reference.objectName);
  }

  async removeObjects(references: StoredObjectReference[]): Promise<void> {
    const objectsByBucket = new Map<string, string[]>();

    for (const reference of references) {
      const objectNames = objectsByBucket.get(reference.bucket) ?? [];
      objectNames.push(reference.objectName);
      objectsByBucket.set(reference.bucket, objectNames);
    }

    await Promise.all(
      [...objectsByBucket].map(([bucket, objectNames]) =>
        this.client.removeObjects(bucket, objectNames),
      ),
    );
  }

  async presignedGetObject(bucket: string, objectName: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, objectName, expirySeconds);
  }

  async bucketExists(bucket: string): Promise<boolean> {
    return this.client.bucketExists(bucket);
  }

  getClient(): Minio.Client {
    return this.client;
  }
}
