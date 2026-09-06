import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignCategory } from './sign-category.entity';
import { TrafficSignType } from './traffic-sign-type.entity';
import { SystemParameter } from './system-parameter.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SignCategory, TrafficSignType, SystemParameter])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
