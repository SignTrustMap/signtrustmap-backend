import crypto from 'node:crypto';

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

async function runAllTests() {
  console.log('========================================================================');
  console.log('SIGNTRUSTMAP - COMPREHENSIVE SURVEY SUBMISSIONS API TEST SUITE');
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
    // Happy Path (SINGLE_IMAGE)
    const payload = {
      submissionType: 'SINGLE_IMAGE',
      capturedAt: new Date().toISOString(),
      coordinateSource: 'DEVICE_GPS',
      note: 'Draft for test image submission',
    };
    const res = await request('/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    validSubmissionId = res.body?.id;
    const pass = res.status === 201 && validSubmissionId && res.body.status === 'DRAFT' && res.body.surveyorId === userId;
    record('Create submission draft', 'Happy Path: Valid SINGLE_IMAGE draft creation', 'POST', '/submissions', 201, res.status, pass, res.body);
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
      note: 'Updated notes via PATCH endpoint',
    };
    const res = await request(`/submissions/${validSubmissionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });
    const pass = res.status === 200 && res.body?.note === updatePayload.note && res.body?.coordinateSource === updatePayload.coordinateSource;
    record('Update submission draft', 'Happy Path: Update metadata on DRAFT submission', 'PATCH', `/submissions/${validSubmissionId}`, 200, res.status, pass, res.body);
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
  const chunk0Data = Buffer.from('TEST_BINARY_CHUNK_0_IMAGE_STREAM_FOR_STM_API_AUTOMATION_TEST_PART_A');
  const chunk1Data = Buffer.from('TEST_BINARY_CHUNK_1_IMAGE_STREAM_FOR_STM_API_AUTOMATION_TEST_PART_B');
  const fullFileBuffer = Buffer.concat([chunk0Data, chunk1Data]);
  const fullChecksum = crypto.createHash('sha256').update(fullFileBuffer).digest('hex');

  {
    // Happy Path: Initialize upload session for SINGLE_IMAGE
    const payload = {
      originalFilename: 'speed_sign_50kmh.jpg',
      mediaType: 'IMAGE',
      totalSizeBytes: fullFileBuffer.length,
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
  // 4. Upload video chunk [POST /submissions/uploads/:sessionId/chunks]
  // ========================================================================
  console.log('\n--- 4. Upload video chunk [POST /submissions/uploads/:sessionId/chunks] ---');
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
  // 13. Get survey upload session details [GET /submissions/uploads/:sessionId]
  // ========================================================================
  console.log('\n--- 13. Get survey upload session details [GET /submissions/uploads/:sessionId] ---');
  {
    const res = await request(`/submissions/uploads/${validSessionId}`);
    const pass = res.status === 200 && res.body?.session?.id === validSessionId && Array.isArray(res.body?.chunks) && res.body.chunks.length === 2;
    record('Get survey upload session details', 'Happy Path: Inspect active session & chunks list', 'GET', `/submissions/uploads/${validSessionId}`, 200, res.status, pass, { session: res.body?.session, chunksCount: res.body?.chunks?.length });
  }
  {
    // Negative Path: Nonexistent session
    const randomUuid = crypto.randomUUID();
    const res = await request(`/submissions/uploads/${randomUuid}`);
    record('Get survey upload session details', 'Negative Path: Nonexistent session returns 404', 'GET', `/submissions/uploads/${randomUuid}`, 404, res.status, res.status === 404, res.body);
  }

  // ========================================================================
  // 5. Complete media upload [POST /submissions/uploads/:sessionId/complete]
  // ========================================================================
  console.log('\n--- 5. Complete media upload [POST /submissions/uploads/:sessionId/complete] ---');
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
  // 6. Submit draft for processing [POST /submissions/:submissionId/submit]
  // ========================================================================
  console.log('\n--- 6. Submit draft for processing [POST /submissions/:submissionId/submit] ---');
  {
    // Happy Path: Complete submission draft
    const res = await request(`/submissions/${validSubmissionId}/submit`, {
      method: 'POST',
    });
    const pass = res.status === 200 && res.body?.accepted === true && res.body?.submission?.status === 'QUEUED';
    record('Submit draft for processing', 'Happy Path: Contract validated and transitioned to QUEUED', 'POST', `/submissions/${validSubmissionId}/submit`, 200, res.status, pass, res.body);
  }
  {
    // Negative Path: Draft missing required media (VIDEO_GPX with no files)
    const res = await request(`/submissions/${incompleteSubmissionId}/submit`, {
      method: 'POST',
    });
    const pass = res.status === 200 && res.body?.accepted === false &&
      res.body?.submission?.status === 'PENDING_CORRECTION' &&
      res.body?.submission?.validationErrors?.length > 0;
    record('Submit draft for processing', 'Contract Validation: Missing media rejected into PENDING_CORRECTION', 'POST', `/submissions/${incompleteSubmissionId}/submit`, 200, res.status, pass, {
      accepted: res.body?.accepted,
      status: res.body?.submission?.status,
      errors: res.body?.submission?.validationErrors,
    });
  }
  {
    // Conflict Path: Re-submitting already QUEUED submission fails with 409
    const res = await request(`/submissions/${validSubmissionId}/submit`, {
      method: 'POST',
    });
    record('Submit draft for processing', 'Conflict Path: Cannot submit submission that is already QUEUED (409 Conflict)', 'POST', `/submissions/${validSubmissionId}/submit`, 409, res.status, res.status === 409, res.body);
  }

  // ========================================================================
  // 10. Get submission pipeline status [GET /submissions/status/:submissionId]
  // ========================================================================
  console.log('\n--- 10. Get submission pipeline status [GET /submissions/status/:submissionId] ---');
  {
    const res = await request(`/submissions/status/${validSubmissionId}`);
    const pass = res.status === 200 &&
      res.body?.submission?.id === validSubmissionId &&
      Array.isArray(res.body?.history) &&
      Array.isArray(res.body?.mediaFiles) &&
      res.body.mediaFiles.length >= 1;
    record('Get submission pipeline status', 'Happy Path: View live processing status and history timeline', 'GET', `/submissions/status/${validSubmissionId}`, 200, res.status, pass, {
      status: res.body?.submission?.status,
      historyCount: res.body?.history?.length,
      mediaCount: res.body?.mediaFiles?.length,
    });
  }
  {
    // Negative Path: Nonexistent submission
    const randomUuid = crypto.randomUUID();
    const res = await request(`/submissions/status/${randomUuid}`);
    record('Get submission pipeline status', 'Negative Path: Nonexistent submission returns 404', 'GET', `/submissions/status/${randomUuid}`, 404, res.status, res.status === 404, res.body);
  }

  // ========================================================================
  // 12. Internal advance submission status [PATCH /submissions/internal/:submissionId/status]
  // ========================================================================
  console.log('\n--- 12. Internal advance submission status [PATCH /submissions/internal/:submissionId/status] ---');
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
    // Happy Path: Advance status to DETECTING
    const res = await request(`/submissions/internal/${validSubmissionId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        status: 'DETECTING',
        note: 'AI Worker: detecting sign candidates in captured image',
      }),
      skipAuth: true,
    });
    const pass = res.status === 200 && res.body?.newStatus === 'DETECTING' && res.body?.previousStatus === 'QUEUED';
    record('Internal advance submission status', 'Happy Path: Advance status QUEUED -> DETECTING', 'PATCH', `/submissions/internal/${validSubmissionId}/status`, 200, res.status, pass, res.body);
  }
  {
    // Happy Path: Advance status from DETECTING to CLASSIFYING
    const res = await request(`/submissions/internal/${validSubmissionId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        status: 'CLASSIFYING',
        note: 'AI Worker: classifying detected signs',
      }),
      skipAuth: true,
    });
    const pass = res.status === 200 && res.body?.newStatus === 'CLASSIFYING' && res.body?.previousStatus === 'DETECTING';
    record('Internal advance submission status', 'Happy Path: Advance status DETECTING -> CLASSIFYING', 'PATCH', `/submissions/internal/${validSubmissionId}/status`, 200, res.status, pass, res.body);
  }

  // ========================================================================
  // 11. Internal mark submission completed [POST /submissions/internal/:submissionId/complete]
  // ========================================================================
  console.log('\n--- 11. Internal mark submission completed [POST /submissions/internal/:submissionId/complete] ---');
  {
    // Negative Path: Missing internal token
    const res = await request(`/submissions/internal/${validSubmissionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Unauthenticated attempt' }),
      skipAuth: true,
    });
    record('Internal mark submission completed', 'Security Guard: Missing X-Internal-Token header rejected with 401', 'POST', `/submissions/internal/${validSubmissionId}/complete`, 401, res.status, res.status === 401, res.body);
  }
  {
    // Happy Path: Mark submission completed, verify credit awarded
    const res = await request(`/submissions/internal/${validSubmissionId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        note: 'AI Pipeline successfully processed all items',
      }),
      skipAuth: true,
    });
    const pass = res.status === 201 && res.body?.submission?.status === 'COMPLETED' && res.body?.alreadyCompleted === false && typeof res.body?.rewardAmount === 'number';
    record('Internal mark submission completed', 'Happy Path: Finalize pipeline, mark COMPLETED and award reward', 'POST', `/submissions/internal/${validSubmissionId}/complete`, 201, res.status, pass, res.body);
  }
  {
    // Happy Path: Idempotent call when already completed
    const res = await request(`/submissions/internal/${validSubmissionId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': INTERNAL_TOKEN,
      },
      body: JSON.stringify({ note: 'Already completed' }),
      skipAuth: true,
    });
    const pass = res.status === 201 && res.body?.alreadyCompleted === true;
    record('Internal mark submission completed', 'Happy Path: Idempotent repeat returns alreadyCompleted=true', 'POST', `/submissions/internal/${validSubmissionId}/complete`, 201, res.status, pass, res.body);
  }

  // ========================================================================
  // 7. List my submissions [GET /submissions/me]
  // ========================================================================
  console.log('\n--- 7. List my submissions [GET /submissions/me] ---');
  {
    const res = await request('/submissions/me?page=1&pageSize=10');
    const pass = res.status === 200 && Array.isArray(res.body?.items) && res.body.items.some((i) => i.id === validSubmissionId);
    record('List my submissions', 'Happy Path: List submissions with pagination', 'GET', '/submissions/me?page=1&pageSize=10', 200, res.status, pass, {
      total: res.body?.total,
      page: res.body?.page,
      pageSize: res.body?.pageSize,
      itemsCount: res.body?.items?.length,
    });
  }

  // ========================================================================
  // 8. Get count of pending submissions [GET /submissions/me/pending]
  // ========================================================================
  console.log('\n--- 8. Get count of pending submissions [GET /submissions/me/pending] ---');
  {
    const res = await request('/submissions/me/pending');
    const pass = res.status === 200 && typeof res.body?.total === 'number' && typeof res.body?.pending === 'number';
    record('Get count of pending submissions', 'Happy Path: Query pending submission counts', 'GET', '/submissions/me/pending', 200, res.status, pass, res.body);
  }

  // ========================================================================
  // 9. Get surveyor statistics [GET /submissions/me/stats]
  // ========================================================================
  console.log('\n--- 9. Get surveyor statistics [GET /submissions/me/stats] ---');
  {
    const res = await request('/submissions/me/stats');
    const pass = res.status === 200 && res.body?.userId === userId && typeof res.body?.totalSubmissions === 'number' && typeof res.body?.creditScore === 'number';
    record('Get surveyor statistics', 'Happy Path: Retrieve surveyor contributor statistics', 'GET', '/submissions/me/stats', 200, res.status, pass, res.body);
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
    console.log(`\n📌 Endpoint Group: [${g}] (${passed}/${groupTests.length} tests passed)`);
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
