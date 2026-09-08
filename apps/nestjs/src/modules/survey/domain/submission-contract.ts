export enum MediaFileType {
  VIDEO = 'VIDEO',
  GPX = 'GPX',
  IMAGE = 'IMAGE',
}

export enum SubmissionType {
  VIDEO_GPX = 'VIDEO_GPX',
  SINGLE_IMAGE = 'SINGLE_IMAGE',
  LIVE_TRIP = 'LIVE_TRIP',
}

export enum CoordinateSource {
  IMAGE_EXIF = 'IMAGE_EXIF',
  DEVICE_GPS = 'DEVICE_GPS',
  MANUAL = 'MANUAL',
  GPX_FILE = 'GPX_FILE',
  LIVE_STREAM = 'LIVE_STREAM',
}

export enum SubmissionValidationCode {
  MISSING_MEDIA = 'MISSING_MEDIA',
  INCOMPLETE_UPLOAD = 'INCOMPLETE_UPLOAD',
  INVALID_COORDINATE_SOURCE = 'INVALID_COORDINATE_SOURCE',
  CAPTURE_TIME_IN_FUTURE = 'CAPTURE_TIME_IN_FUTURE',
}

export enum CorrectionRequirementCode {
  UPLOAD_MEDIA = 'UPLOAD_MEDIA',
  COMPLETE_UPLOAD = 'COMPLETE_UPLOAD',
  CHANGE_COORDINATE_SOURCE = 'CHANGE_COORDINATE_SOURCE',
  CONFIRM_CAPTURE_TIME = 'CONFIRM_CAPTURE_TIME',
}

export interface SubmissionContractIssue {
  code: SubmissionValidationCode | CorrectionRequirementCode | string;
  field: string;
  message: string;
  mediaType?: MediaFileType;
}

export interface SubmissionTypeContract {
  requiredMediaTypes: readonly MediaFileType[];
  allowedCoordinateSources: readonly CoordinateSource[];
}

export const SUBMISSION_TYPE_CONTRACTS: Readonly<
  Record<SubmissionType, SubmissionTypeContract>
> = {
  [SubmissionType.SINGLE_IMAGE]: {
    requiredMediaTypes: [MediaFileType.IMAGE],
    allowedCoordinateSources: [
      CoordinateSource.IMAGE_EXIF,
      CoordinateSource.DEVICE_GPS,
      CoordinateSource.MANUAL,
    ],
  },
  [SubmissionType.VIDEO_GPX]: {
    requiredMediaTypes: [MediaFileType.VIDEO, MediaFileType.GPX],
    allowedCoordinateSources: [CoordinateSource.GPX_FILE],
  },
  [SubmissionType.LIVE_TRIP]: {
    requiredMediaTypes: [MediaFileType.VIDEO],
    allowedCoordinateSources: [CoordinateSource.LIVE_STREAM],
  },
};
