import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignCategory } from '../../entities/sign-category.entity';
import { TrafficSignType } from '../../entities/traffic-sign-type.entity';
import { SystemParameter } from '../../entities/system-parameter.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SignCategory, TrafficSignType, SystemParameter])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
