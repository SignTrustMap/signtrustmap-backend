import {
  CorrectionRequirementCode,
  MediaFileType,
  SubmissionContractIssue,
  SubmissionValidationCode,
} from './submission-contract';

export interface GpxTrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: Date;
}

export interface GpxParseResult {
  points: GpxTrackPoint[];
  startTime?: Date;
  endTime?: Date;
}

export interface FileSignatureResult {
  valid: boolean;
  detectedFormat?: string;
  error?: string;
}

export interface MediaDecodeResult {
  valid: boolean;
  durationSeconds?: number;
  dimensions?: { width: number; height: number };
  error?: string;
}

/**
 * Validate magic numbers / file signatures for expected media type.
 */
export function validateFileSignature(
  mediaType: MediaFileType,
  buffer: Buffer,
): FileSignatureResult {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'File buffer is too small to determine file signature' };
  }

  if (mediaType === MediaFileType.IMAGE) {
    // 1. JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, detectedFormat: 'JPEG' };
    }
    // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { valid: true, detectedFormat: 'PNG' };
    }
    // 3. WebP: RIFF ... WEBP
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { valid: true, detectedFormat: 'WEBP' };
    }
    // 4. HEIC / HEIF / AVIF: offset 4 'ftyp'
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12).toLowerCase();
      if (['heic', 'heix', 'mif1', 'msf1', 'hevc', 'avif'].some((b) => brand.includes(b))) {
        return { valid: true, detectedFormat: 'HEIF' };
      }
    }
    return {
      valid: false,
      error: 'File does not match any accepted image signature (JPEG, PNG, WebP, HEIF)',
    };
  }

  if (mediaType === MediaFileType.VIDEO) {
    // 1. MP4 / MOV / M4V / QuickTime: offset 4 'ftyp', 'moov', or 'mdat'
    if (buffer.length >= 8) {
      const box = buffer.toString('ascii', 4, 8);
      if (['ftyp', 'moov', 'mdat'].includes(box)) {
        return { valid: true, detectedFormat: 'MP4' };
      }
    }
    // 2. MKV / WebM: 1A 45 DF A3
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return { valid: true, detectedFormat: 'MKV/WEBM' };
    }
    // 3. AVI: RIFF ... AVI
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'AVI '
    ) {
      return { valid: true, detectedFormat: 'AVI' };
    }
    return {
      valid: false,
      error: 'File does not match any accepted video signature (MP4, MOV, MKV, WebM, AVI)',
    };
  }

  if (mediaType === MediaFileType.GPX) {
    const head = buffer.toString('utf8', 0, Math.min(buffer.length, 1024)).trim();
    const lowerHead = head.toLowerCase();
    if (
      (lowerHead.startsWith('<?xml') && lowerHead.includes('<gpx')) ||
      lowerHead.startsWith('<gpx')
    ) {
      return { valid: true, detectedFormat: 'GPX' };
    }
    return {
      valid: false,
      error: 'File does not have a valid XML/GPX signature (missing <gpx> root element)',
    };
  }

  if (mediaType === MediaFileType.FRAME_SEQUENCE) {
    const head = buffer.toString('utf8', 0, Math.min(buffer.length, 1024)).trim();
    if (head.startsWith('{') || head.startsWith('[')) {
      try {
        JSON.parse(buffer.toString('utf8'));
        return { valid: true, detectedFormat: 'JSON_FRAME_MANIFEST' };
      } catch {
        return { valid: false, error: 'Frame sequence manifest is not valid JSON' };
      }
    }
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    ) {
      return { valid: true, detectedFormat: 'ZIP' };
    }
    return {
      valid: false,
      error: 'File does not match any accepted frame sequence format (JSON manifest or ZIP archive)',
    };
  }

  return { valid: false, error: `Unknown media type: ${mediaType}` };
}

/**
 * Attempt to decode media payload and extract metadata (e.g. dimensions, duration).
 */
export function decodeMedia(mediaType: MediaFileType, buffer: Buffer): MediaDecodeResult {
  const sig = validateFileSignature(mediaType, buffer);
  if (!sig.valid) {
    return { valid: false, error: sig.error };
  }

  try {
    if (mediaType === MediaFileType.IMAGE) {
      if (sig.detectedFormat === 'JPEG') {
        return decodeJpeg(buffer);
      }
      if (sig.detectedFormat === 'PNG') {
        return decodePng(buffer);
      }
      if (sig.detectedFormat === 'WEBP') {
        return decodeWebp(buffer);
      }
      return { valid: true, dimensions: { width: 1, height: 1 } };
    }

    if (mediaType === MediaFileType.VIDEO) {
      if (sig.detectedFormat === 'MP4') {
        return decodeMp4(buffer);
      }
      return { valid: true };
    }

    if (mediaType === MediaFileType.GPX) {
      const gpx = parseGpx(buffer);
      if (!gpx.valid) {
        return { valid: false, error: gpx.error };
      }
      return { valid: true };
    }

    if (mediaType === MediaFileType.FRAME_SEQUENCE) {
      if (sig.detectedFormat === 'JSON_FRAME_MANIFEST') {
        const manifest = JSON.parse(buffer.toString('utf8'));
        const frames = Array.isArray(manifest) ? manifest : manifest?.frames;
        if (!Array.isArray(frames) || frames.length === 0) {
          return { valid: false, error: 'Frame sequence manifest contains no frames' };
        }
        return { valid: true };
      }
      return { valid: true };
    }
  } catch (err: any) {
    return { valid: false, error: `Media decoding exception: ${err?.message}` };
  }

  return { valid: true };
}

function decodeJpeg(buffer: Buffer): MediaDecodeResult {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;

    // Standalone markers
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      continue;
    }

    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;

    // SOF markers containing width/height
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length >= 7 && offset + 7 <= buffer.length) {
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) {
          return { valid: true, dimensions: { width, height } };
        }
      }
    }
    offset += length;
  }
  // If SOI was valid, treat as valid JPEG even if truncated before SOF
  return { valid: true, dimensions: { width: 1, height: 1 } };
}

function decodePng(buffer: Buffer): MediaDecodeResult {
  if (buffer.length < 24) {
    return { valid: false, error: 'PNG buffer too small for IHDR' };
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    return { valid: false, error: 'Corrupt PNG: first chunk is not IHDR' };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { valid: false, error: 'Corrupt PNG: dimensions are zero' };
  }
  return { valid: true, dimensions: { width, height } };
}

function decodeWebp(buffer: Buffer): MediaDecodeResult {
  if (buffer.length < 16) {
    return { valid: false, error: 'WebP buffer too small' };
  }
  return { valid: true, dimensions: { width: 1, height: 1 } };
}

function decodeMp4(buffer: Buffer): MediaDecodeResult {
  let offset = 0;
  let durationSeconds: number | undefined;

  while (offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    const boxType = buffer.toString('ascii', offset + 4, offset + 8);

    if (boxType === 'moov') {
      let subOffset = offset + 8;
      const moovEnd = offset + (boxSize === 0 ? buffer.length - offset : boxSize);
      while (subOffset + 8 <= Math.min(moovEnd, buffer.length)) {
        const subSize = buffer.readUInt32BE(subOffset);
        const subType = buffer.toString('ascii', subOffset + 4, subOffset + 8);
        if (subType === 'mvhd') {
          const version = buffer.readUInt8(subOffset + 8);
          if (version === 0 && subOffset + 28 <= buffer.length) {
            const timescale = buffer.readUInt32BE(subOffset + 20);
            const duration = buffer.readUInt32BE(subOffset + 24);
            if (timescale > 0) durationSeconds = duration / timescale;
          } else if (version === 1 && subOffset + 40 <= buffer.length) {
            const timescale = buffer.readUInt32BE(subOffset + 28);
            const durationHigh = buffer.readUInt32BE(subOffset + 32);
            const durationLow = buffer.readUInt32BE(subOffset + 36);
            const duration = durationHigh * 4294967296 + durationLow;
            if (timescale > 0) durationSeconds = duration / timescale;
          }
          break;
        }
        if (subSize <= 0 || subOffset + subSize > moovEnd) break;
        subOffset += subSize;
      }
    }

    if (boxSize <= 0 || offset + boxSize > buffer.length) break;
    offset += boxSize;
  }

  return { valid: true, durationSeconds };
}

/**
 * Parse GPX file XML content into structured track points.
 */
export function parseGpx(buffer: Buffer): {
  valid: boolean;
  result?: GpxParseResult;
  error?: string;
} {
  const content = buffer.toString('utf8').trim();
  const lower = content.toLowerCase();
  if (!lower.includes('<gpx')) {
    return { valid: false, error: 'GPX file missing root <gpx> element' };
  }

  const pointRegex =
    /<(?:trkpt|wpt)\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:trkpt|wpt)>/gi;
  const altPointRegex =
    /<(?:trkpt|wpt)\s+[^>]*lon=["']([^"']+)["'][^>]*lat=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:trkpt|wpt)>/gi;
  const timeRegex = /<time>([^<]+)<\/time>/i;
  const eleRegex = /<ele>([^<]+)<\/ele>/i;

  const points: GpxTrackPoint[] = [];

  let match: RegExpExecArray | null;
  while ((match = pointRegex.exec(content)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];

    let time: Date | undefined;
    const timeMatch = timeRegex.exec(inner);
    if (timeMatch) {
      const d = new Date(timeMatch[1].trim());
      if (!isNaN(d.getTime())) time = d;
    }

    let ele: number | undefined;
    const eleMatch = eleRegex.exec(inner);
    if (eleMatch) {
      const e = parseFloat(eleMatch[1].trim());
      if (!isNaN(e)) ele = e;
    }

    points.push({ lat, lon, ele, time });
  }

  if (points.length === 0) {
    while ((match = altPointRegex.exec(content)) !== null) {
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      const inner = match[3];

      let time: Date | undefined;
      const timeMatch = timeRegex.exec(inner);
      if (timeMatch) {
        const d = new Date(timeMatch[1].trim());
        if (!isNaN(d.getTime())) time = d;
      }

      let ele: number | undefined;
      const eleMatch = eleRegex.exec(inner);
      if (eleMatch) {
        const e = parseFloat(eleMatch[1].trim());
        if (!isNaN(e)) ele = e;
      }

      points.push({ lat, lon, ele, time });
    }
  }

  let startTime: Date | undefined;
  let endTime: Date | undefined;

  for (const pt of points) {
    if (pt.time) {
      if (!startTime || pt.time < startTime) startTime = pt.time;
      if (!endTime || pt.time > endTime) endTime = pt.time;
    }
  }

  return {
    valid: true,
    result: {
      points,
      startTime,
      endTime,
    },
  };
}

/**
 * Validate GPX track points (GPS coordinates range, presence of points, timestamps,
 * and time-range matching against submission capture time).
 */
export function validateGpxAndTrajectory(
  gpx: GpxParseResult,
  capturedAt?: Date,
): {
  validationErrors: SubmissionContractIssue[];
  correctionRequirements: SubmissionContractIssue[];
} {
  const validationErrors: SubmissionContractIssue[] = [];
  const correctionRequirements: SubmissionContractIssue[] = [];

  // 1. Check point count
  if (!gpx.points || gpx.points.length === 0) {
    validationErrors.push({
      code: SubmissionValidationCode.GPX_EMPTY_TRACK,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: 'GPX trajectory does not contain any recorded GPS track points',
    });
    correctionRequirements.push({
      code: CorrectionRequirementCode.PROVIDE_VALID_GPX,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: 'Upload a companion GPX file containing recorded GPS track points',
    });
    return { validationErrors, correctionRequirements };
  }

  // 2. Check GPS coordinates bounds (-90 <= lat <= 90, -180 <= lon <= 180)
  const invalidCoordinates = gpx.points.filter(
    (pt) =>
      isNaN(pt.lat) ||
      isNaN(pt.lon) ||
      pt.lat < -90 ||
      pt.lat > 90 ||
      pt.lon < -180 ||
      pt.lon > 180,
  );

  if (invalidCoordinates.length > 0) {
    validationErrors.push({
      code: SubmissionValidationCode.INVALID_GPS_COORDINATES,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: `${invalidCoordinates.length} GPS coordinate(s) in GPX track are out of valid range [-90..90, -180..180]`,
    });
    correctionRequirements.push({
      code: CorrectionRequirementCode.CORRECT_GPS_COORDINATES,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: 'Ensure all recorded GPS track points have valid latitude and longitude coordinates',
    });
  }

  // 3. Check for timestamps on track points
  const pointsWithTime = gpx.points.filter((pt) => pt.time !== undefined);
  if (pointsWithTime.length === 0) {
    validationErrors.push({
      code: SubmissionValidationCode.GPX_MISSING_TIMESTAMPS,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: 'GPX track points do not contain timestamp metadata required for video synchronisation',
    });
    correctionRequirements.push({
      code: CorrectionRequirementCode.PROVIDE_VALID_GPX,
      field: 'mediaFiles',
      mediaType: MediaFileType.GPX,
      message: 'Upload a GPX file with ISO timestamp metadata on track points',
    });
  } else if (capturedAt && gpx.startTime && gpx.endTime) {
    // 4. Timestamp-range matching (allow 15-minute tolerance)
    const toleranceMs = 15 * 60 * 1000;
    const captureMs = capturedAt.getTime();
    const startMs = gpx.startTime.getTime();
    const endMs = gpx.endTime.getTime();

    if (captureMs < startMs - toleranceMs || captureMs > endMs + toleranceMs) {
      validationErrors.push({
        code: SubmissionValidationCode.TIMESTAMP_RANGE_MISMATCH,
        field: 'capturedAt',
        mediaType: MediaFileType.GPX,
        message: `Submission capture time (${capturedAt.toISOString()}) is outside GPX trajectory range [${gpx.startTime.toISOString()} - ${gpx.endTime.toISOString()}]`,
      });
      correctionRequirements.push({
        code: CorrectionRequirementCode.ADJUST_TIMESTAMP_OR_GPX,
        field: 'capturedAt',
        mediaType: MediaFileType.GPX,
        message: 'Adjust submission capture time or provide matching GPX trajectory file',
      });
    }
  }

  return { validationErrors, correctionRequirements };
}
