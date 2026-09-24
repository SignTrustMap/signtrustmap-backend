import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignCategory } from './sign-category.entity';
import { TrafficSignType } from './traffic-sign-type.entity';
import { SystemParameter } from './system-parameter.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { SignTypeAiPrompt } from './sign-type-ai-prompt.entity';
import { SignTypeImage } from './sign-type-image.entity';
import { SignTypeOsmMapping } from './sign-type-osm-mapping.entity';
import { CatalogSyncModule } from '../../integrations/catalog-sync/catalog-sync.module';


@Module({
  imports: [
    CatalogSyncModule,
    TypeOrmModule.forFeature([
      SignCategory,
      TrafficSignType,
      SystemParameter,
      SignTypeAiPrompt,
      SignTypeOsmMapping,
      SignTypeImage,
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
