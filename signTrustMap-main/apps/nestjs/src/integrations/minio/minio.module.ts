import { Module, Global } from '@nestjs/common';
import { MinioStorageService } from './minio-storage.service';

@Global()
@Module({
  providers: [MinioStorageService],
  exports: [MinioStorageService],
})
export class MinioModule {}
