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
    const isR2 = endpoint.includes('r2.cloudflarestorage.com');
    const region =
      this.configService.get<string>('minio.region') ?? (isR2 ? 'auto' : undefined);

    const clientOptions: Minio.ClientOptions = {
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    };
    if (region) {
      clientOptions.region = region;
    }

    this.client = new Minio.Client(clientOptions);

    this.logger.log(
      `MinIO client configured: ${endpoint}:${port} (SSL=${useSSL}, region=${region ?? 'none'})`,
    );
  }

  bucketForMediaType(mediaType: string): string {
    switch (mediaType) {
      case 'VIDEO':
      case 'FRAME_SEQUENCE':
        return STM_BUCKETS.VIDEO;
      case 'GPX':
        return STM_BUCKETS.GPX;
      case 'IMAGE':
        return STM_BUCKETS.IMAGE;
      default:
        return STM_BUCKETS.VIDEO;
    }
  }

  getPublicUrl(bucket: string, objectName: string): string {
    const s3Domain =
      this.configService.get<string>('minio.s3Domain') ||
      process.env.S3_DOMAIN ||
      's3.signmap.site';

    const cleanObject = objectName.replace(/^\/+/, '');
    const cleanBucket = bucket.replace(/^\/+|\/+$/g, '');

    const fullPath = cleanObject.startsWith(`${cleanBucket}/`)
      ? cleanObject
      : `${cleanBucket}/${cleanObject}`;

    if (s3Domain) {
      const isLocal = s3Domain.includes('localhost') || s3Domain.includes('127.0.0.1');
      const useSSL = this.configService.get<boolean>('minio.useSSL') ?? !isLocal;
      const protocol = useSSL ? 'https' : 'http';
      return `${protocol}://${s3Domain}/${fullPath}`;
    }

    const publicBase =
      this.configService.get<string>('minio.publicUrl') ||
      process.env.S3_PUBLIC_URL ||
      process.env.MINIO_PUBLIC_URL;
    if (publicBase) {
      return `${publicBase.replace(/\/+$/, '')}/${fullPath}`;
    }

    return `https://s3.signmap.site/${fullPath}`;
  }

  async putObject(
    bucket: string,
    objectName: string,
    buffer: Buffer,
    contentType?: string,
  ): Promise<void> {
    let resolvedContentType = contentType;
    if (
      !resolvedContentType ||
      resolvedContentType === 'text/plain' ||
      resolvedContentType === 'application/octet-stream'
    ) {
      if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        resolvedContentType = 'image/jpeg';
      } else if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      ) {
        resolvedContentType = 'image/png';
      } else if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      ) {
        resolvedContentType = 'image/webp';
      } else {
        const ext = objectName.split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') resolvedContentType = 'image/jpeg';
        else if (ext === 'png') resolvedContentType = 'image/png';
        else if (ext === 'webp') resolvedContentType = 'image/webp';
        else if (ext === 'mp4') resolvedContentType = 'video/mp4';
        else if (ext === 'gpx') resolvedContentType = 'application/gpx+xml';
      }
    }

    const meta: Record<string, string> = {};
    if (resolvedContentType) meta['Content-Type'] = resolvedContentType;

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

  async presignedPutObject(bucket: string, objectName: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedPutObject(bucket, objectName, expirySeconds);
  }

  async bucketExists(bucket: string): Promise<boolean> {
    return this.client.bucketExists(bucket);
  }

  async getObjectBuffer(
    reference: StoredObjectReference,
    maxBytes?: number,
  ): Promise<Buffer> {
    const stream = await this.client.getObject(reference.bucket, reference.objectName);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (maxBytes && total >= maxBytes) {
        stream.destroy();
        break;
      }
    }
    return Buffer.concat(chunks);
  }

  getClient(): Minio.Client {
    return this.client;
  }
}
