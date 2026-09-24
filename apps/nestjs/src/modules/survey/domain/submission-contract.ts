export enum MediaFileType {
  VIDEO = 'VIDEO',
  GPX = 'GPX',
  IMAGE = 'IMAGE',
  FRAME_SEQUENCE = 'FRAME_SEQUENCE',
}

export enum SubmissionType {
  VIDEO_GPX = 'VIDEO_GPX',
  SINGLE_IMAGE = 'SINGLE_IMAGE',
  LIVE_TRIP = 'LIVE_TRIP',
  FRAME_BATCH = 'FRAME_BATCH',
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
  INVALID_FILE_SIGNATURE = 'INVALID_FILE_SIGNATURE',
  UNSUPPORTED_FILE_FORMAT = 'UNSUPPORTED_FILE_FORMAT',
  MEDIA_DECODE_FAILED = 'MEDIA_DECODE_FAILED',
  CORRUPTED_FILE = 'CORRUPTED_FILE',
  GPX_EMPTY_TRACK = 'GPX_EMPTY_TRACK',
  GPX_MISSING_TIMESTAMPS = 'GPX_MISSING_TIMESTAMPS',
  INVALID_GPS_COORDINATES = 'INVALID_GPS_COORDINATES',
  TIMESTAMP_RANGE_MISMATCH = 'TIMESTAMP_RANGE_MISMATCH',
}

export enum CorrectionRequirementCode {
  UPLOAD_MEDIA = 'UPLOAD_MEDIA',
  COMPLETE_UPLOAD = 'COMPLETE_UPLOAD',
  CHANGE_COORDINATE_SOURCE = 'CHANGE_COORDINATE_SOURCE',
  CONFIRM_CAPTURE_TIME = 'CONFIRM_CAPTURE_TIME',
  REPLACE_FILE = 'REPLACE_FILE',
  PROVIDE_VALID_GPX = 'PROVIDE_VALID_GPX',
  CORRECT_GPS_COORDINATES = 'CORRECT_GPS_COORDINATES',
  ADJUST_TIMESTAMP_OR_GPX = 'ADJUST_TIMESTAMP_OR_GPX',
}

export const REJECTED_VALIDATION_CODES = new Set<string>([
  SubmissionValidationCode.INVALID_FILE_SIGNATURE,
  SubmissionValidationCode.UNSUPPORTED_FILE_FORMAT,
  SubmissionValidationCode.MEDIA_DECODE_FAILED,
  SubmissionValidationCode.CORRUPTED_FILE,
]);

export const MEDIA_SIZE_LIMITS: Record<MediaFileType, { maxBytes: number; minBytes: number }> = {
  [MediaFileType.IMAGE]: {
    maxBytes: 50 * 1024 * 1024, // 50 MB
    minBytes: 1,
  },
  [MediaFileType.VIDEO]: {
    maxBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    minBytes: 1,
  },
  [MediaFileType.GPX]: {
    maxBytes: 20 * 1024 * 1024, // 20 MB
    minBytes: 1,
  },
  [MediaFileType.FRAME_SEQUENCE]: {
    maxBytes: 500 * 1024 * 1024, // 500 MB
    minBytes: 1,
  },
};

export const MAX_CHUNK_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_CHUNKS_PER_SESSION = 5000;

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
  [SubmissionType.FRAME_BATCH]: {
    requiredMediaTypes: [MediaFileType.FRAME_SEQUENCE],
    allowedCoordinateSources: [
      CoordinateSource.DEVICE_GPS,
      CoordinateSource.GPX_FILE,
      CoordinateSource.IMAGE_EXIF,
    ],
  },
};
