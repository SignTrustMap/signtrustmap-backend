import { Module } from '@nestjs/common';
import { AiInferenceService } from './ai-inference.service';

@Module({
  providers: [AiInferenceService],
  exports: [AiInferenceService],
})
export class AiInferenceModule {}
