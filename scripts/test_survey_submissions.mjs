import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/api/v1';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || 'stm_internal_secret_dev';

let accessToken = '';
let userId = '';

const testResults = [];

function record(endpointGroup, testCase, method, path, expectedStatus, actualStatus, pass, details = {}) {
  testResults.push({
    endpointGroup,
    testCase,
    method,
    path,
    expectedStatus,
    actualStatus,
    pass,
    details,
  });
  const symbol = pass ? '  ✅ [PASS]' : '  ❌ [FAIL]';
  console.log(`${symbol} [${actualStatus}] ${method} ${path} :: ${testCase}`);
  if (!pass || process.env.VERBOSE === 'true') {
    console.log('     Details:', JSON.stringify(details, null, 2));
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...options.headers };
  if (accessToken && !headers['Authorization'] && !headers['authorization'] && !options.skipAuth) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  let body;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { res, status: res.status, ok: res.ok, body };
}

// Media fixture buffers
const validJpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const validJpegBuffer = Buffer.from(validJpegBase64, 'base64');

// Valid MP4 container (ftyp + moov box)
const validMp4Buffer = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]),
  Buffer.from([0x00, 0x00, 0x00, 0x08, 0x6d, 0x6f, 0x6f, 0x76]),
]);

function generateValidGpx(date) {
  const t0 = new Date(date.getTime() - 60000).toISOString();
  const t1 = date.toISOString();
  const t2 = new Date(date.getTime() + 60000).toISOString();
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SignTrustMap">
  <trk>
    <name>Survey Track</name>
    <trkseg>
      <trkpt lat="21.0285" lon="105.8342">
        <ele>12.0</ele>
        <time>${t0}</time>
      </trkpt>
      <trkpt lat="21.0290" lon="105.8350">
        <ele>12.5</ele>
        <time>${t1}</time>
      </trkpt>
      <trkpt lat="21.0295" lon="105.8358">
        <ele>13.0</ele>
        <time>${t2}</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`, 'utf8');
}

async function uploadFileInChunks(submissionId, filename, mediaType, fileBuffer, numChunks = 1) {
  const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const initRes = await request(`/submissions/${submissionId}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originalFilename: filename,
      mediaType,
      totalSizeBytes: fileBuffer.length,
      totalChunks: numChunks,
      checksumExpected: checksum,
    }),
  });
  if (!initRes.ok) throw new Error(`Init upload failed: ${JSON.stringify(initRes.body)}`);
  const sessionId = initRes.body.sessionId;

  const chunkSize = Math.ceil(fileBuffer.length / numChunks);
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileBuffer.length);
    const chunkData = fileBuffer.subarray(start, end);
    const chunkHash = crypto.createHash('sha256').update(chunkData).digest('hex');

    const form = new FormData();
    form.append('chunkIndex', String(i));
    form.append('checksum', chunkHash);
    form.append('file', new Blob([chunkData], { type: 'application/octet-stream' }), `chunk_${i}.bin`);

    const chunkRes = await request(`/submissions/uploads/${sessionId}/chunks`, {
      method: 'POST',
      body: form,
    });
    if (!chunkRes.ok) throw new Error(`Chunk ${i} failed: ${JSON.stringify(chunkRes.body)}`);
  }

  const compRes = await request(`/submissions/uploads/${sessionId}/complete`, { method: 'POST' });
  if (!compRes.ok) throw new Error(`Complete failed: ${JSON.stringify(compRes.body)}`);
  return { sessionId, mediaFileId: compRes.body.mediaFileId, checksum };
}

async function runAllTests() {
  console.log('========================================================================');
  console.log('SIGNTRUSTMAP - FULL END-TO-END SURVEY VERIFICATION TEST SUITE');
  console.log(`Base URL:       ${BASE_URL}`);
  console.log(`Internal Token: ${INTERNAL_TOKEN.slice(0, 4)}****`);
  console.log('========================================================================\n');

  // --- Authentication ---
  console.log('🔐 [Auth Setup] Authenticating as demo surveyor (demo@stm.dev)...');
  const loginRes = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@stm.dev', password: 'Demo@123' }),
    skipAuth: true,
  });
  if (!loginRes.ok) {
    console.error('Failed to log in:', loginRes.body);
    process.exit(1);
  }
  accessToken = loginRes.body.accessToken;
  userId = loginRes.body.user.id;
  console.log(`   User ID: ${userId} (${loginRes.body.user.email})`);
  console.log(`   Roles:   ${loginRes.body.user.roles.join(', ')}\n`);

  // Shared test variables
  let validSubmissionId = '';
  let validSessionId = '';
  let incompleteSubmissionId = '';

  // ========================================================================
  // 1. Create submission draft [POST /submissions]
  // ========================================================================
  console.log('--- 1. Create submission draft [POST /submissions] ---');
  {
    // Happy Path (SINGLE_IMAGE) with GPS metadata
    const payload = {
      submissionType: 'SINGLE_IMAGE',
      capturedAt: new Date().toISOString(),
      coordinateSource: 'DEVICE_GPS',
      latitude: 21.0285,
      longitude: 105.8342,
      note: 'Speed limit sign outside station',
    };
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    validSubmissionId = res.body?.id;
    const pass = res.status === 201 && validSubmissionId &&
      res.body.status === 'DRAFT' &&
      res.body.surveyorId === userId &&
      res.body.latitude === 21.0285 &&
      res.body.longitude === 105.8342;
    record('Create submission draft', 'Happy Path: Valid SINGLE_IMAGE draft creation with GPS coordinates', 'POST', '/submissions', 201, res.status, pass, res.body);
  }
  {
    // Happy Path (VIDEO_GPX)
    const payload = {
      submissionType: 'VIDEO_GPX',
      capturedAt: new Date().toISOString(),
      coordinateSource: 'GPX_FILE',
      note: 'Draft for test video + gpx submission',
    };
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    incompleteSubmissionId = res.body?.id;
    const pass = res.status === 201 && incompleteSubmissionId && res.body.status === 'DRAFT';
    record('Create submission draft', 'Happy Path: Valid VIDEO_GPX draft creation', 'POST', '/submissions', 201, res.status, pass, res.body);
  }
  {
    // Happy Path (LIVE_TRIP)
    const payload = {
      submissionType: 'LIVE_TRIP',
      capturedAt: new Date().toISOString(),
      coordinateSource: 'DEVICE_GPS',
      note: 'Live survey trip recording',
    };
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const pass = res.status === 201 && res.body?.id && res.body.status === 'DRAFT' && res.body.submissionType === 'LIVE_TRIP';
    record('Create submission draft', 'Happy Path: Valid LIVE_TRIP draft creation', 'POST', '/submissions', 201, res.status, pass, res.body);
  }
  {
    // Negative Path: Invalid enum
    const payload = {
      submissionType: 'INVALID_TYPE',
      capturedAt: new Date().toISOString(),
      coordinateSource: 'DEVICE_GPS',
    };
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    record('Create submission draft', 'Negative Path: Invalid submissionType enum rejects with 400', 'POST', '/submissions', 400, res.status, res.status === 400, res.body);
  }
  {
    // Negative Path: Unauthorized
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionType: 'SINGLE_IMAGE', capturedAt: new Date().toISOString(), coordinateSource: 'DEVICE_GPS' }),
      skipAuth: true,
    });
    record('Create submission draft', 'Negative Path: Missing Bearer token rejects with 401', 'POST', '/submissions', 401, res.status, res.status === 401, res.body);
  }

  // ========================================================================
  // 2. Update submission draft [PATCH /submissions/:submissionId]
  // ========================================================================
  console.log('\n--- 2. Update submission draft [PATCH /submissions/:submissionId] ---');
  {
    const updatePayload = {
      capturedAt: new Date(Date.now() - 120000).toISOString(),
      coordinateSource: 'IMAGE_EXIF',
      latitude: 21.0300,
      longitude: 105.8355,
      note: 'Updated notes via PATCH endpoint',
    };
    const res = await request(`/submissions/${validSubmissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });
    const pass = res.status === 200 &&
      res.body?.note === updatePayload.note &&
      res.body?.coordinateSource === updatePayload.coordinateSource &&
      res.body?.latitude === 21.0300 &&
      res.body?.longitude === 105.8355;
    record('Update submission draft', 'Happy Path: Update metadata & GPS on DRAFT submission', 'PATCH', `/submissions/${validSubmissionId}`, 200, res.status, pass, res.body);
  }
  {
    // Negative Path: Nonexistent submission ID
    const randomUuid = crypto.randomUUID();
    const res = await request(`/submissions/${randomUuid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Nonexistent' }),
    });
    record('Update submission draft', 'Negative Path: Nonexistent submission returns 404', 'PATCH', `/submissions/${randomUuid}`, 404, res.status, res.status === 404, res.body);
  }
  {
    // Negative Path: Unauthorized
    const res = await request(`/submissions/${validSubmissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Unauth' }),
      skipAuth: true,
    });
    record('Update submission draft', 'Negative Path: Missing Bearer token returns 401', 'PATCH', `/submissions/${validSubmissionId}`, 401, res.status, res.status === 401, res.body);
  }

  // ========================================================================
  // 3. Initialize media upload [POST /submissions/:submissionId/uploads]
  // ========================================================================
  console.log('\n--- 3. Initialize media upload [POST /submissions/:submissionId/uploads] ---');
  const halfLen = Math.floor(validJpegBuffer.length / 2);
  const chunk0Data = validJpegBuffer.subarray(0, halfLen);
  const chunk1Data = validJpegBuffer.subarray(halfLen);
  const fullChecksum = crypto.createHash('sha256').update(validJpegBuffer).digest('hex');

  {
    // Happy Path: Initialize upload session for SINGLE_IMAGE
    const payload = {
      originalFilename: 'speed_sign_50kmh.jpg',
      mediaType: 'IMAGE',
      totalSizeBytes: validJpegBuffer.length,
      totalChunks: 2,
      checksumExpected: fullChecksum,
    };
    const res = await request(`/submissions/${validSubmissionId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    validSessionId = res.body?.sessionId;
    const pass = res.status === 201 && validSessionId && res.body.status === 'INITIATED' && res.body.totalChunks === 2;
    record('Initialize media upload', 'Happy Path: Initialize 2-chunk IMAGE upload', 'POST', `/submissions/${validSubmissionId}/uploads`, 201, res.status, pass, res.body);
  }
  {
    // Negative Path: Exceed max totalSizeBytes limit for IMAGE (50MB)
    const payload = {
      originalFilename: 'huge.jpg',
      mediaType: 'IMAGE',
      totalSizeBytes: 60 * 1024 * 1024,
      totalChunks: 2,
    };
    const res = await request(`/submissions/${validSubmissionId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    record('Initialize media upload', 'Negative Path: Exceeding max size for mediaType returns 400', 'POST', `/submissions/${validSubmissionId}/uploads`, 400, res.status, res.status === 400, res.body);
  }
  {
    // Negative Path: Invalid media type for contract (e.g. VIDEO for SINGLE_IMAGE)
    const payload = {
      originalFilename: 'invalid_video.mp4',
      mediaType: 'VIDEO',
      totalSizeBytes: 1024,
      totalChunks: 1,
    };
    const res = await request(`/submissions/${validSubmissionId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    record('Initialize media upload', 'Negative Path: Unaccepted mediaType for contract returns 400', 'POST', `/submissions/${validSubmissionId}/uploads`, 400, res.status, res.status === 400, res.body);
  }
  {
    // Negative Path: Nonexistent submission
    const randomUuid = crypto.randomUUID();
    const res = await request(`/submissions/${randomUuid}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalFilename: 'test.jpg', mediaType: 'IMAGE', totalSizeBytes: 100, totalChunks: 1 }),
    });
    record('Initialize media upload', 'Negative Path: Nonexistent submission returns 404', 'POST', `/submissions/${randomUuid}/uploads`, 404, res.status, res.status === 404, res.body);
  }

  // ========================================================================
  // 4. Upload chunk & chunk resume workflow
  // ========================================================================
  console.log('\n--- 4. Upload chunk & chunk resume workflow ---');
  {
    // Negative Path: Checksum mismatch
    const formBad = new FormData();
    formBad.append('chunkIndex', '0');
    formBad.append('checksum', '0000000000000000000000000000000000000000000000000000000000000000');
    formBad.append('file', new Blob([chunk0Data], { type: 'image/jpeg' }), 'chunk0.bin');

    const res = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: formBad,
    });
    record('Upload video chunk', 'Negative Path: Checksum mismatch rejected with 400', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 400, res.status, res.status === 400, res.body);
  }
  {
    // Negative Path: Chunk index out of range
    const formOutOfRange = new FormData();
    formOutOfRange.append('chunkIndex', '99');
    formOutOfRange.append('file', new Blob([chunk0Data], { type: 'image/jpeg' }), 'chunk99.bin');

    const res = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: formOutOfRange,
    });
    record('Upload video chunk', 'Negative Path: chunkIndex >= totalChunks returns 400', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 400, res.status, res.status === 400, res.body);
  }
  {
    // Negative Path: Empty chunk file
    const formEmpty = new FormData();
    formEmpty.append('chunkIndex', '0');
    formEmpty.append('file', new Blob([Buffer.alloc(0)], { type: 'image/jpeg' }), 'empty.bin');

    const res = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: formEmpty,
    });
    record('Upload video chunk', 'Negative Path: Empty chunk (0 bytes) returns 400', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 400, res.status, res.status === 400, res.body);
  }
  {
    // Happy Path: Upload chunk 0
    const form0 = new FormData();
    const hash0 = crypto.createHash('sha256').update(chunk0Data).digest('hex');
    form0.append('chunkIndex', '0');
    form0.append('checksum', hash0);
    form0.append('file', new Blob([chunk0Data], { type: 'image/jpeg' }), 'chunk0.bin');

    const res0 = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: form0,
    });
    const pass0 = res0.status === 201 && res0.body?.receivedChunks === 1 && res0.body?.readyToComplete === false;
    record('Upload video chunk', 'Happy Path: Successfully upload chunk 0 of 2', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 201, res0.status, pass0, res0.body);

    // Happy Path: Idempotent re-upload of identical chunk 0
    const res0Dup = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: form0,
    });
    const pass0Dup = res0Dup.status === 201 && res0Dup.body?.chunkIndex === 0;
    record('Upload video chunk', 'Happy Path: Idempotent re-upload of chunk 0 accepted', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 201, res0Dup.status, pass0Dup, res0Dup.body);

    // Happy Path: Upload chunk 1 (final chunk)
    const form1 = new FormData();
    const hash1 = crypto.createHash('sha256').update(chunk1Data).digest('hex');
    form1.append('chunkIndex', '1');
    form1.append('checksum', hash1);
    form1.append('file', new Blob([chunk1Data], { type: 'image/jpeg' }), 'chunk1.bin');

    const res1 = await request(`/submissions/uploads/${validSessionId}/chunks`, {
      method: 'POST',
      body: form1,
    });
    const pass1 = res1.status === 201 && res1.body?.receivedChunks === 2 && res1.body?.readyToComplete === true;
    record('Upload video chunk', 'Happy Path: Successfully upload chunk 1 of 2 (readyToComplete)', 'POST', `/submissions/uploads/${validSessionId}/chunks`, 201, res1.status, pass1, res1.body);
  }

  // ========================================================================
  // 5. Interrupted and resumed upload session verification
  // ========================================================================
  console.log('\n--- 5. Interrupted and resumed upload session verification ---');
  {
    // Create draft and 3-chunk session
    const resumeSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionType: 'SINGLE_IMAGE', capturedAt: new Date().toISOString(), coordinateSource: 'DEVICE_GPS' }),
    });
    const resumeSubId = resumeSubRes.body?.id;
    const resumePayload = Buffer.from('RESUME_TEST_IMAGE_FILE_PAYLOAD_CHUNKED_ABCDEFG');
    const cSize = Math.ceil(resumePayload.length / 3);
    const rc0 = resumePayload.subarray(0, cSize);
    const rc1 = resumePayload.subarray(cSize, cSize * 2);
    const rc2 = resumePayload.subarray(cSize * 2);

    const resumeInit = await request(`/submissions/${resumeSubId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalFilename: 'resume_test.jpg',
        mediaType: 'IMAGE',
        totalSizeBytes: resumePayload.length,
        totalChunks: 3,
      }),
    });
    const resumeSessionId = resumeInit.body?.sessionId;

    // Upload chunk 0 and chunk 2 (intentionally skipping chunk 1 to simulate interruption)
    const f0 = new FormData();
    f0.append('chunkIndex', '0');
    f0.append('file', new Blob([rc0], { type: 'image/jpeg' }), 'c0.bin');
    await request(`/submissions/uploads/${resumeSessionId}/chunks`, { method: 'POST', body: f0 });

    const f2 = new FormData();
    f2.append('chunkIndex', '2');
    f2.append('file', new Blob([rc2], { type: 'image/jpeg' }), 'c2.bin');
    await request(`/submissions/uploads/${resumeSessionId}/chunks`, { method: 'POST', body: f2 });

    // Inspect session: chunk 1 should be reported missing, resumable = true
    const checkResumable = await request(`/submissions/uploads/${resumeSessionId}`);
    const passInterrupted = checkResumable.status === 200 &&
      Array.isArray(checkResumable.body?.missingChunkIndices) &&
      checkResumable.body.missingChunkIndices.includes(1) &&
      checkResumable.body.uploadedChunkIndices.length === 2 &&
      checkResumable.body.progressPercent === 67 &&
      checkResumable.body.isResumable === true &&
      checkResumable.body.readyToComplete === false;
    record('Interrupted & Resumed Upload', 'Resume Support: Detect missingChunkIndices=[1] and isResumable=true', 'GET', `/submissions/uploads/${resumeSessionId}`, 200, checkResumable.status, passInterrupted, {
      missing: checkResumable.body?.missingChunkIndices,
      uploaded: checkResumable.body?.uploadedChunkIndices,
      progress: checkResumable.body?.progressPercent,
      ready: checkResumable.body?.readyToComplete,
    });

    // Resume upload: upload missing chunk 1
    const f1 = new FormData();
    f1.append('chunkIndex', '1');
    f1.append('file', new Blob([rc1], { type: 'image/jpeg' }), 'c1.bin');
    const res1 = await request(`/submissions/uploads/${resumeSessionId}/chunks`, { method: 'POST', body: f1 });
    const passResumed = res1.status === 201 && res1.body?.readyToComplete === true;
    record('Interrupted & Resumed Upload', 'Resume Support: Upload missing chunk 1 and verify readyToComplete=true', 'POST', `/submissions/uploads/${resumeSessionId}/chunks`, 201, res1.status, passResumed, res1.body);

    // Verify session is now 100% complete
    const checkComplete = await request(`/submissions/uploads/${resumeSessionId}`);
    const passAllChunks = checkComplete.status === 200 &&
      checkComplete.body.missingChunkIndices.length === 0 &&
      checkComplete.body.progressPercent === 100 &&
      checkComplete.body.readyToComplete === true;
    record('Interrupted & Resumed Upload', 'Resume Support: Session verified 100% ready after resume', 'GET', `/submissions/uploads/${resumeSessionId}`, 200, checkComplete.status, passAllChunks, checkComplete.body);
  }

  // ========================================================================
  // 6. Complete media upload [POST /submissions/uploads/:sessionId/complete]
  // ========================================================================
  console.log('\n--- 6. Complete media upload [POST /submissions/uploads/:sessionId/complete] ---');
  {
    const res = await request(`/submissions/uploads/${validSessionId}/complete`, {
      method: 'POST',
    });
    const pass = res.status === 201 && res.body?.status === 'COMPLETED' && res.body?.mediaFileId && res.body?.checksum === fullChecksum;
    record('Complete media upload', 'Happy Path: Assemble chunks & create SubmissionMediaFile', 'POST', `/submissions/uploads/${validSessionId}/complete`, 201, res.status, pass, res.body);
  }
  {
    // Idempotent repeat completion
    const res = await request(`/submissions/uploads/${validSessionId}/complete`, {
      method: 'POST',
    });
    const pass = res.status === 201 && res.body?.status === 'COMPLETED';
    record('Complete media upload', 'Happy Path: Idempotent repeat completion returns COMPLETED', 'POST', `/submissions/uploads/${validSessionId}/complete`, 201, res.status, pass, res.body);
  }

  // ========================================================================
  // 7. Submit draft for processing & Validation error scenarios
  // ========================================================================
  console.log('\n--- 7. Submit draft for processing & Validation error scenarios ---');
  {
    // Happy Path: Image success (Complete submission draft -> QUEUED)
    const res = await request(`/submissions/${validSubmissionId}/submit`, {
      method: 'POST',
    });
    const pass = res.status === 200 && res.body?.accepted === true && res.body?.submission?.status === 'QUEUED';
    record('Submit draft for processing', 'Image Success: Valid JPEG and GPS accepted into QUEUED', 'POST', `/submissions/${validSubmissionId}/submit`, 200, res.status, pass, res.body);
  }
  {
    // Conflict Path: Re-submitting already QUEUED submission fails with 409
    const res = await request(`/submissions/${validSubmissionId}/submit`, {
      method: 'POST',
    });
    record('Submit draft for processing', 'Conflict Path: Cannot submit submission that is already QUEUED (409 Conflict)', 'POST', `/submissions/${validSubmissionId}/submit`, 409, res.status, res.status === 409, res.body);
  }
  {
    // Missing metadata/media: Draft missing required media (VIDEO_GPX with no files)
    const res = await request(`/submissions/${incompleteSubmissionId}/submit`, {
      method: 'POST',
    });
    const pass = res.status === 200 && res.body?.accepted === false &&
      res.body?.submission?.status === 'PENDING_CORRECTION' &&
      res.body?.submission?.validationErrors?.length > 0;
    record('Submit draft for processing', 'Validation Failure: Missing media rejected into PENDING_CORRECTION', 'POST', `/submissions/${incompleteSubmissionId}/submit`, 200, res.status, pass, {
      accepted: res.body?.accepted,
      status: res.body?.submission?.status,
      errors: res.body?.submission?.validationErrors,
    });
  }
  {
    // Invalid File Signature: Submission with corrupted / non-image signature rejected into REJECTED
    const badSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'SINGLE_IMAGE',
        capturedAt: new Date().toISOString(),
        coordinateSource: 'DEVICE_GPS',
        note: 'Invalid file signature test',
      }),
    });
    const badSubId = badSubRes.body?.id;
    if (badSubId) {
      const badPayload = Buffer.from('NOT_AN_IMAGE_PAYLOAD!');
      const badInit = await request(`/submissions/${badSubId}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalFilename: 'corrupt.jpg',
          mediaType: 'IMAGE',
          totalSizeBytes: badPayload.length,
          totalChunks: 1,
        }),
      });
      const badSessionId = badInit.body?.sessionId;
      if (badSessionId) {
        const badForm = new FormData();
        badForm.append('chunkIndex', '0');
        badForm.append('file', new Blob([badPayload], { type: 'image/jpeg' }), 'corrupt.bin');
        await request(`/submissions/uploads/${badSessionId}/chunks`, { method: 'POST', body: badForm });
        await request(`/submissions/uploads/${badSessionId}/complete`, { method: 'POST' });

        const submitBad = await request(`/submissions/${badSubId}/submit`, { method: 'POST' });
        const passBad = submitBad.status === 200 && submitBad.body?.accepted === false && submitBad.body?.submission?.status === 'REJECTED';
        record('Submit draft for processing', 'Invalid Files: Invalid signature rejected into REJECTED', 'POST', `/submissions/${badSubId}/submit`, 200, submitBad.status, passBad, {
          accepted: submitBad.body?.accepted,
          status: submitBad.body?.submission?.status,
          errors: submitBad.body?.submission?.validationErrors,
        });

        // Re-submitting REJECTED submission must fail with 409
        const resubmitBad = await request(`/submissions/${badSubId}/submit`, { method: 'POST' });
        record('Submit draft for processing', 'Invalid Files: Cannot re-submit REJECTED submission (409 Conflict)', 'POST', `/submissions/${badSubId}/submit`, 409, resubmitBad.status, resubmitBad.status === 409, resubmitBad.body);
      }
    }
  }
  {
    // GPX Coordinate Validation: Video submission with out-of-range GPS points rejected into PENDING_CORRECTION
    const gpxBadSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'VIDEO_GPX',
        capturedAt: new Date().toISOString(),
        coordinateSource: 'GPX_FILE',
        note: 'Invalid GPS bounds test',
      }),
    });
    const gpxBadSubId = gpxBadSubRes.body?.id;
    if (gpxBadSubId) {
      await uploadFileInChunks(gpxBadSubId, 'dashcam.mp4', 'VIDEO', validMp4Buffer);
      const badGpxXml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><trkseg><trkpt lat="999.0" lon="105.0"><time>${new Date().toISOString()}</time></trkpt></trkseg></trk></gpx>`);
      await uploadFileInChunks(gpxBadSubId, 'track.gpx', 'GPX', badGpxXml);

      const submitGpxBad = await request(`/submissions/${gpxBadSubId}/submit`, { method: 'POST' });
      const passGpxBad = submitGpxBad.status === 200 &&
        submitGpxBad.body?.accepted === false &&
        submitGpxBad.body?.submission?.status === 'PENDING_CORRECTION' &&
        submitGpxBad.body?.submission?.validationErrors?.some((e) => e.code === 'INVALID_GPS_COORDINATES');
      record('Submit draft for processing', 'Validation Failure: Out-of-bounds GPS coordinates in GPX -> PENDING_CORRECTION', 'POST', `/submissions/${gpxBadSubId}/submit`, 200, submitGpxBad.status, passGpxBad, submitGpxBad.body?.submission?.validationErrors);
    }
  }
  {
    // GPX Timestamp Mismatch: Video capture time outside GPX track interval -> PENDING_CORRECTION
    const mismatchSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'VIDEO_GPX',
        capturedAt: new Date().toISOString(), // Today
        coordinateSource: 'GPX_FILE',
        note: 'Timestamp mismatch test',
      }),
    });
    const mismatchSubId = mismatchSubRes.body?.id;
    if (mismatchSubId) {
      await uploadFileInChunks(mismatchSubId, 'video.mp4', 'VIDEO', validMp4Buffer);
      const oldGpxXml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><trkseg><trkpt lat="21.0285" lon="105.8342"><time>2020-01-01T00:00:00.000Z</time></trkpt></trkseg></trk></gpx>`);
      await uploadFileInChunks(mismatchSubId, 'track.gpx', 'GPX', oldGpxXml);

      const submitMismatch = await request(`/submissions/${mismatchSubId}/submit`, { method: 'POST' });
      const passMismatch = submitMismatch.status === 200 &&
        submitMismatch.body?.accepted === false &&
        submitMismatch.body?.submission?.status === 'PENDING_CORRECTION' &&
        submitMismatch.body?.submission?.validationErrors?.some((e) => e.code === 'TIMESTAMP_RANGE_MISMATCH');
      record('Submit draft for processing', 'Validation Failure: GPX timestamp mismatch -> PENDING_CORRECTION', 'POST', `/submissions/${mismatchSubId}/submit`, 200, submitMismatch.status, passMismatch, submitMismatch.body?.submission?.validationErrors);
    }
  }

  // ========================================================================
  // 8. Video-GPX Success Path
  // ========================================================================
  console.log('\n--- 8. Video-GPX Success Path ---');
  let videoGpxSubmissionId = '';
  {
    const now = new Date();
    const videoGpxSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'VIDEO_GPX',
        capturedAt: now.toISOString(),
        coordinateSource: 'GPX_FILE',
        note: 'Full video + GPX track success',
      }),
    });
    videoGpxSubmissionId = videoGpxSubRes.body?.id;
    if (videoGpxSubmissionId) {
      await uploadFileInChunks(videoGpxSubmissionId, 'drive_route_hanoi.mp4', 'VIDEO', validMp4Buffer);
      const validGpx = generateValidGpx(now);
      await uploadFileInChunks(videoGpxSubmissionId, 'trajectory.gpx', 'GPX', validGpx);

      const submitRes = await request(`/submissions/${videoGpxSubmissionId}/submit`, { method: 'POST' });
      const passVideoGpx = submitRes.status === 200 && submitRes.body?.accepted === true && submitRes.body?.submission?.status === 'QUEUED';
      record('Video-GPX Success', 'Happy Path: Valid MP4 container and synchronized GPX accepted into QUEUED', 'POST', `/submissions/${videoGpxSubmissionId}/submit`, 200, submitRes.status, passVideoGpx, submitRes.body);
    }
  }

  // ========================================================================
  // 9. AI Pipeline Stage Transitions, Failure & Queue Retry
  // ========================================================================
  console.log('\n--- 9. AI Pipeline Stage Transitions, Failure & Queue Retry ---');
  {
    // Negative Path: Missing internal token
    const res = await request(`/submissions/internal/${validSubmissionId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DETECTING' }),
      skipAuth: true,
    });
    record('Internal advance submission status', 'Security Guard: Missing X-Internal-Token header rejected with 401', 'PATCH', `/submissions/internal/${validSubmissionId}/status`, 401, res.status, res.status === 401, res.body);
  }
  {
    // Happy Path: Stage transitions SYNCHRONIZING -> DETECTING -> TRACKING -> ESTIMATING -> CLASSIFYING
    const stages = [
      { status: 'SYNCHRONIZING', note: 'AI Worker: Synchronizing media from MinIO' },
      { status: 'DETECTING', note: 'AI Worker: Detecting signs in media' },
      { status: 'TRACKING', note: 'AI Worker: Tracking candidate instances' },
      { status: 'ESTIMATING', note: 'AI Worker: Estimating physical sign coordinates' },
      { status: 'CLASSIFYING', note: 'AI Worker: Resolving sign type labels from catalog' },
    ];
    for (const stage of stages) {
      const res = await request(`/submissions/internal/${validSubmissionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
        body: JSON.stringify(stage),
        skipAuth: true,
      });
      const pass = res.status === 200 && res.body?.newStatus === stage.status;
      record('Internal advance submission status', `AI Stage Transition: -> ${stage.status}`, 'PATCH', `/submissions/internal/${validSubmissionId}/status`, 200, res.status, pass, res.body);
    }
  }
  {
    // AI Failure & Queue Retry Path: Simulate pipeline failure transition
    const failSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionType: 'SINGLE_IMAGE', capturedAt: new Date().toISOString(), coordinateSource: 'DEVICE_GPS' }),
    });
    const failSubId = failSubRes.body?.id;
    if (failSubId) {
      await uploadFileInChunks(failSubId, 'fail_test.jpg', 'IMAGE', validJpegBuffer);
      await request(`/submissions/${failSubId}/submit`, { method: 'POST' });

      // Advance to FAILED with failure reason
      const failRes = await request(`/submissions/internal/${failSubId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
        body: JSON.stringify({
          status: 'FAILED',
          note: 'Model inference timeout after max retries exceeded',
          validationErrors: [{ code: 'INFERENCE_TIMEOUT', field: 'pipeline', message: 'Inference engine unreachable' }],
        }),
        skipAuth: true,
      });
      const passFail = failRes.status === 200 && failRes.body?.newStatus === 'FAILED';
      record('AI Failure & Retry', 'Happy Path: Transition to FAILED with failure reason recorded', 'PATCH', `/submissions/internal/${failSubId}/status`, 200, failRes.status, passFail, failRes.body);

      // Verify status inspection shows FAILED
      const checkFail = await request(`/submissions/status/${failSubId}`);
      const passCheck = checkFail.status === 200 && checkFail.body?.submission?.status === 'FAILED';
      record('AI Failure & Retry', 'Visibility: Inspection reflects terminal status FAILED', 'GET', `/submissions/status/${failSubId}`, 200, checkFail.status, passCheck, checkFail.body?.submission?.status);
    }
  }
  {
    // Mark Completed & Rewards
    const res = await request(`/submissions/internal/${validSubmissionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ note: 'Pipeline completed successfully' }),
      skipAuth: true,
    });
    const pass = res.status === 201 && res.body?.submission?.status === 'COMPLETED' && res.body?.alreadyCompleted === false && typeof res.body?.rewardAmount === 'number';
    record('Internal mark submission completed', 'Happy Path: Finalize pipeline, mark COMPLETED and award reward', 'POST', `/submissions/internal/${validSubmissionId}/complete`, 201, res.status, pass, res.body);

    // Idempotent repeat completion
    const resDup = await request(`/submissions/internal/${validSubmissionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ note: 'Repeat completion' }),
      skipAuth: true,
    });
    const passDup = resDup.status === 201 && resDup.body?.alreadyCompleted === true;
    record('Internal mark submission completed', 'Idempotency: Duplicate completion call returns alreadyCompleted=true', 'POST', `/submissions/internal/${validSubmissionId}/complete`, 201, resDup.status, passDup, resDup.body);
  }

  // ========================================================================
  // 10. Live Celery Worker & Real Mock AI Processing
  // ========================================================================
  console.log('\n--- 10. Live Celery Worker & Real Mock AI Processing ---');
  {
    // Create new submission to be processed live by Celery Worker
    const liveSubRes = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'SINGLE_IMAGE',
        capturedAt: new Date().toISOString(),
        coordinateSource: 'DEVICE_GPS',
        latitude: 21.0285,
        longitude: 105.8342,
        note: 'Live worker processing test image',
      }),
    });
    const liveSubId = liveSubRes.body?.id;
    if (liveSubId) {
      await uploadFileInChunks(liveSubId, 'live_sign.jpg', 'IMAGE', validJpegBuffer);
      await request(`/submissions/${liveSubId}/submit`, { method: 'POST' });

      // Ensure ai-inference container is running on stm-network
      try {
        execSync('docker ps | grep ai-inference || docker run -d --name ai-inference --network stm-network -p 8089:8000 python:3.11-slim python3 -c "from http.server import BaseHTTPRequestHandler, HTTPServer; import json\nclass M(BaseHTTPRequestHandler):\n    def do_POST(self):\n        sid = self.path.rstrip(\'/\').split(\'/\')[-1]\n        self.send_response(200)\n        self.send_header(\'Content-Type\', \'application/json\')\n        self.end_headers()\n        self.wfile.write(json.dumps({\'submission_id\': sid, \'status\': \'SUCCESS\', \'image_width\': 1920, \'image_height\': 1080, \'signs\': [{\'class_name\': \'P.102\', \'confidence\': 0.96, \'box_xyxy\': [200, 150, 450, 500], \'best_frame_key\': \'stm-sign-crops/test_frame.jpg\', \'sign_crop_key\': \'stm-sign-crops/test_crop.jpg\', \'timestamp_seconds\': 1.5}]}).encode())\n    def do_GET(self):\n        self.send_response(200)\n        self.end_headers()\n        self.wfile.write(b\'ok\')\nHTTPServer((\'0.0.0.0\', 8000), M).serve_forever()"', { encoding: 'utf8', stdio: 'pipe' });
      } catch {}

      // Trigger Celery dispatch task
      try {
        execSync('docker compose exec -T celery-worker python -c "from app.tasks.ai_pipeline import task_dispatch_queued_submissions; task_dispatch_queued_submissions()"', { encoding: 'utf8', timeout: 10000 });
      } catch (e) {
        console.log('   (Celery dispatch command issued)');
      }

      // Poll until COMPLETED or timeout (up to 15 seconds)
      let finalStatus = '';
      let candidates = [];
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await request(`/submissions/status/${liveSubId}`);
        finalStatus = st.body?.submission?.status || '';
        candidates = st.body?.candidates || [];
        if (finalStatus === 'COMPLETED') break;
      }

      const passLive = finalStatus === 'COMPLETED' && candidates.length > 0;
      record('Celery & AI Integration', 'End-to-End: Worker processed submission through Redis, MinIO, Mock AI, and persisted candidate in Postgres', 'POLL', `/submissions/status/${liveSubId}`, 200, 200, passLive, {
        status: finalStatus,
        candidatesCount: candidates.length,
        candidate: candidates[0],
      });

      // Verify Candidate details and Geo Estimation
      if (candidates.length > 0) {
        const c = candidates[0];
        const passGeo = c.sign_code === 'P.102' &&
          c.sign_location_geojson !== null &&
          c.estimated_distance > 0 &&
          c.bearing_angle >= 0;
        record('Celery & AI Integration', 'Spatial Estimation: Candidate has sign_code P.102, valid GeoJSON point, and distance estimation', 'DB_ASSERT', `candidates[0]`, 200, 200, passGeo, {
          sign_code: c.sign_code,
          sign_location: c.sign_location_geojson,
          distance: c.estimated_distance,
          bearing: c.bearing_angle,
        });
      }
    }
  }

  // ========================================================================
  // 11. Monitoring, History Timeline, and Surveyor Stats
  // ========================================================================
  console.log('\n--- 11. Monitoring, History Timeline, and Surveyor Stats ---');
  {
    // Pipeline status and timeline history
    const res = await request(`/submissions/status/${validSubmissionId}`);
    const pass = res.status === 200 &&
      res.body?.submission?.id === validSubmissionId &&
      Array.isArray(res.body?.history) &&
      res.body.history.length >= 3 &&
      Array.isArray(res.body?.mediaFiles) &&
      res.body.mediaFiles.length >= 1;
    record('Monitoring & Status', 'Happy Path: View live processing status and chronological history timeline', 'GET', `/submissions/status/${validSubmissionId}`, 200, res.status, pass, {
      status: res.body?.submission?.status,
      historyLength: res.body?.history?.length,
      historyStages: res.body?.history?.map((h) => `${h.old_status}->${h.new_status}`),
    });
  }
  {
    // List my submissions with pagination
    const res = await request('/submissions/me?page=1&pageSize=10');
    const pass = res.status === 200 &&
      Array.isArray(res.body?.items) &&
      res.body.items.some((i) => i.id === validSubmissionId) &&
      res.body.items.some((i) => typeof i.latitude === 'number' && typeof i.longitude === 'number');
    record('Monitoring & Status', 'Happy Path: List submissions with pagination and GPS coordinates', 'GET', '/submissions/me?page=1&pageSize=10', 200, res.status, pass, {
      total: res.body?.total,
      page: res.body?.page,
      pageSize: res.body?.pageSize,
      hasCoordinates: res.body?.items?.some((i) => i.latitude !== null),
    });
  }
  {
    // Get pending count with breakdown by status
    const res = await request('/submissions/me/pending');
    const pass = res.status === 200 &&
      typeof res.body?.total === 'number' &&
      typeof res.body?.pending === 'number' &&
      typeof res.body?.countsByStatus === 'object';
    record('Monitoring & Status', 'Happy Path: Query pending submission counts and countsByStatus breakdown', 'GET', '/submissions/me/pending', 200, res.status, pass, res.body);
  }
  {
    // Get surveyor stats
    const res = await request('/submissions/me/stats');
    const pass = res.status === 200 && res.body?.userId === userId && typeof res.body?.totalSubmissions === 'number' && typeof res.body?.creditScore === 'number';
    record('Monitoring & Status', 'Happy Path: Retrieve surveyor contributor statistics', 'GET', '/submissions/me/stats', 200, res.status, pass, res.body);
  }

  // ========================================================================
  // SUMMARY REPORT
  // ========================================================================
  console.log('\n========================================================================');
  console.log('FINAL TEST EXECUTION SUMMARY:');
  console.log('========================================================================');

  const groups = [...new Set(testResults.map((r) => r.endpointGroup))];
  for (const g of groups) {
    const groupTests = testResults.filter((r) => r.endpointGroup === g);
    const passed = groupTests.filter((r) => r.pass).length;
    console.log(`\n📌 Test Group: [${g}] (${passed}/${groupTests.length} tests passed)`);
    for (const t of groupTests) {
      const sym = t.pass ? '   ✅' : '   ❌';
      console.log(`${sym} ${t.testCase} -> HTTP ${t.actualStatus}`);
    }
  }

  const totalPassed = testResults.filter((r) => r.pass).length;
  console.log('\n------------------------------------------------------------------------');
  console.log(`TOTAL TESTS: ${testResults.length} | PASSED: ${totalPassed} | FAILED: ${testResults.length - totalPassed}`);
  console.log('------------------------------------------------------------------------\n');

  if (totalPassed !== testResults.length) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
