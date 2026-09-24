import { PartialType } from '@nestjs/swagger';
import { CreateCameraProfileDto } from './create-camera-profile.dto';

export class UpdateCameraProfileDto extends PartialType(CreateCameraProfileDto) {}
