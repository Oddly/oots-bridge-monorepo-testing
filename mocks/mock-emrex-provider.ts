/**
 * Mock EMREX Data Provider (EMP)
 *
 * Simulates an EMREX provider that:
 * - Receives redirect from Bridge with state info
 * - Displays a mock consent page (simulated)
 * - Returns ELMO data to Bridge's /store endpoint
 *
 * This mock can be configured to:
 * - Return success with ELMO data
 * - Return error codes
 * - Simulate timeout (no response)
 */

import Fastify from 'fastify';
import * as zlib from 'zlib';

const PORT = process.env.MOCK_EMREX_PORT || 9081;
const BRIDGE_STORE_URL = process.env.BRIDGE_STORE_URL || 'http://localhost:3003/store';

const app = Fastify({ logger: true });

// Sample ELMO data (simplified)
const sampleElmo = `<?xml version="1.0" encoding="UTF-8"?>
<elmo xmlns="https://github.com/emrex-eu/elmo-schemas/tree/v1"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <generatedDate>2025-01-09T10:00:00Z</generatedDate>
  <learner>
    <citizenship>NL</citizenship>
    <identifier type="nationalIdentifier">BSN123456789</identifier>
    <givenNames>Jonas</givenNames>
    <familyName>Smith</familyName>
    <bday>1999-03-01</bday>
  </learner>
  <report>
    <issuer>
      <identifier type="schac">urn:schac:personalUniqueCode:nl:local:universityX</identifier>
      <title xml:lang="en">University X</title>
      <country>NL</country>
    </issuer>
    <learningOpportunitySpecification>
      <identifier type="local">DEGREE-001</identifier>
      <title xml:lang="en">Bachelor of Science in Computer Science</title>
      <type>Degree</type>
      <iscedCode>0613</iscedCode>
      <specifies>
        <learningOpportunityInstance>
          <start>2017-09-01</start>
          <date>2021-06-30</date>
          <status>passed</status>
          <resultLabel>Cum Laude</resultLabel>
          <credit>
            <scheme>ects</scheme>
            <value>180</value>
          </credit>
        </learningOpportunityInstance>
      </specifies>
    </learningOpportunitySpecification>
  </report>
  <attachment>
    <type>Diploma</type>
    <title xml:lang="en">Diploma Certificate</title>
    <content>
      <!-- Base64 encoded PDF would go here in real scenario -->
      JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PD4+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY4IDAwMDAwIG4gCjAwMDAwMDAxMjUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoyMjMKJSVFT0Y=
    </content>
  </attachment>
</elmo>`;

// Behavior configuration (can be changed via API)
type BehaviorMode =
  | 'success'
  | 'error'
  | 'timeout'
  | 'no_records'
  | 'cancel'
  | 'invalid_gzip'
  | 'invalid_xml'
  | 'identity_mismatch';

let behavior: BehaviorMode = 'success';
let responseDelay = 0; // milliseconds

// Invalid XML that will fail schema validation
const invalidElmoXml = `<?xml version="1.0" encoding="UTF-8"?>
<elmo xmlns="https://github.com/emrex-eu/elmo-schemas/tree/v1">
  <generatedDate>2025-01-14T10:00:00Z</generatedDate>
  <learner>
    <givenNames>Jonas</givenNames>
    <familyName>Smith</familyName>
    <bday>1999-03-01</bday>
  </learner>
  <report>
    <issuer>
      <identifier type="schac">invalid</identifier>
      <country>NL</country>
    </issuer>
  </report>
</elmo>`;

// ELMO with mismatched identity (different name/DOB)
const mismatchedIdentityElmo = `<?xml version="1.0" encoding="UTF-8"?>
<elmo xmlns="https://github.com/emrex-eu/elmo-schemas/tree/v1"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <generatedDate>2025-01-14T10:00:00Z</generatedDate>
  <learner>
    <citizenship>NL</citizenship>
    <identifier type="nationalIdentifier">BSN999999999</identifier>
    <givenNames>WrongFirstName</givenNames>
    <familyName>WrongLastName</familyName>
    <bday>1985-12-25</bday>
  </learner>
  <report>
    <issuer>
      <identifier type="schac">urn:schac:personalUniqueCode:nl:local:universityX</identifier>
      <title xml:lang="en">University X</title>
      <country>NL</country>
    </issuer>
    <learningOpportunitySpecification>
      <identifier type="local">DEGREE-002</identifier>
      <title xml:lang="en">Bachelor of Arts</title>
      <type>Degree</type>
      <iscedCode>0613</iscedCode>
      <specifies>
        <learningOpportunityInstance>
          <start>2017-09-01</start>
          <date>2021-06-30</date>
          <status>passed</status>
          <credit>
            <scheme>ects</scheme>
            <value>180</value>
          </credit>
        </learningOpportunityInstance>
      </specifies>
    </learningOpportunitySpecification>
  </report>
</elmo>`;

// Store endpoint redirect (simulates user completing EMREX flow)
app.get('/emrex', async (request, reply) => {
  const { sessionId, returnUrl } = request.query as { sessionId?: string; returnUrl?: string };

  console.log(`[Mock EMREX] Received redirect - sessionId: ${sessionId}, returnUrl: ${returnUrl}`);

  if (!sessionId || !returnUrl) {
    return reply.code(400).send({ error: 'Missing sessionId or returnUrl' });
  }

  if (behavior === 'timeout') {
    console.log('[Mock EMREX] Simulating timeout - not responding');
    // Never respond - simulate timeout
    return new Promise(() => {}); // Hang forever
  }

  // Simulate user interaction delay
  if (responseDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, responseDelay));
  }

  // Prepare response based on behavior
  let returnCode: string;
  let elmoData: string | null = null;
  let returnMessage: string | null = null;

  switch (behavior) {
    case 'success':
      returnCode = 'NCP_OK';
      // Compress and base64 encode ELMO
      elmoData = zlib.gzipSync(Buffer.from(sampleElmo, 'utf-8')).toString('base64');
      break;
    case 'error':
      returnCode = 'NCP_ERROR';
      returnMessage = 'An error occurred at the EMREX provider';
      break;
    case 'no_records':
      returnCode = 'NCP_NO_RESULTS';
      returnMessage = 'No matching records found for this learner';
      break;
    case 'cancel':
      returnCode = 'NCP_CANCEL';
      returnMessage = 'User cancelled the EMREX flow';
      break;
    case 'invalid_gzip':
      returnCode = 'NCP_OK';
      // Send non-gzipped data (will fail inflate)
      elmoData = Buffer.from('this is not gzipped data').toString('base64');
      break;
    case 'invalid_xml':
      returnCode = 'NCP_OK';
      // Send gzipped but invalid XML (will fail schema validation)
      elmoData = zlib.gzipSync(Buffer.from(invalidElmoXml, 'utf-8')).toString('base64');
      break;
    case 'identity_mismatch':
      returnCode = 'NCP_OK';
      // Send valid ELMO but with mismatched identity
      elmoData = zlib.gzipSync(Buffer.from(mismatchedIdentityElmo, 'utf-8')).toString('base64');
      break;
    default:
      returnCode = 'NCP_OK';
  }

  console.log(`[Mock EMREX] Sending response to Bridge - returnCode: ${returnCode}`);

  // POST to Bridge's /store endpoint (simulating the callback)
  try {
    const response = await fetch(returnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sessionId,
        returnCode,
        ...(elmoData && { elmo: elmoData }),
        ...(returnMessage && { returnMessage }),
      }),
    });

    console.log(`[Mock EMREX] Bridge response status: ${response.status}`);

    // Return a simple HTML page (what user would see)
    reply.header('Content-Type', 'text/html');
    return `
      <html>
        <body>
          <h1>Mock EMREX Provider</h1>
          <p>Data has been sent to the Bridge.</p>
          <p>Return code: ${returnCode}</p>
          <p>You will be redirected shortly...</p>
        </body>
      </html>
    `;
  } catch (error) {
    console.error('[Mock EMREX] Error sending to Bridge:', error);
    reply.code(500);
    return { error: 'Failed to communicate with Bridge' };
  }
});

// POST version (some providers use POST)
app.post('/emrex', async (request, reply) => {
  const body = request.body as any;
  const sessionId = body.sessionId || body.stateId;
  const returnUrl = body.returnUrl;

  // Reuse GET handler logic
  (request.query as any).sessionId = sessionId;
  (request.query as any).returnUrl = returnUrl;

  return app.inject({
    method: 'GET',
    url: `/emrex?sessionId=${sessionId}&returnUrl=${encodeURIComponent(returnUrl)}`,
  });
});

// ============================================================================
// REST API for test control
// ============================================================================

// Set behavior
app.post('/test/behavior', async (request, reply) => {
  const { mode, delay } = request.body as { mode?: string; delay?: number };

  const validModes: BehaviorMode[] = [
    'success',
    'error',
    'timeout',
    'no_records',
    'cancel',
    'invalid_gzip',
    'invalid_xml',
    'identity_mismatch',
  ];

  if (mode && validModes.includes(mode as BehaviorMode)) {
    behavior = mode as BehaviorMode;
  }
  if (typeof delay === 'number') {
    responseDelay = delay;
  }

  console.log(`[Mock EMREX] Behavior set to: ${behavior}, delay: ${responseDelay}ms`);
  return { behavior, responseDelay };
});

// Get current config
app.get('/test/config', async () => {
  return { behavior, responseDelay };
});

// Health check
app.get('/health', async () => {
  return { status: 'ok', behavior, responseDelay };
});

// ============================================================================
// Mock Certificate Endpoint (for Bridge certificate manager)
// ============================================================================

// Sample RSA public key for testing (not a real key - testing only)
const MOCK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyf8BLfZ/pZ2xN
oJpcXHwWrRkRGMlKOGHnNQRGKXW+8rbFOZ2c8IZvZ2yqQv1X9VeGLKxW3JWqLG9N1X5e0CzBqE6z
qU4q/5qUdmT8XwXl3qB8dC0y0yJME8b3uQ3E8FhfqX+ZTpKJr7zP2Q5M9y9Zy+6P9qZ+H5qm8r0z
c+X3ZqU4q/5qUdmT8XwXl3qB8dC0y0yJME8b3uQ3E8FhfqX+ZTpKJr7zP2Q5M9y9Zy+6P9qZ+H5q
m8r0zc+X3ZqU4q/5qUdmT8XwXl3qB8dC0y0yJME8b3uQ3E8FhfqX+ZTpKJr7zP2Q5M9y9Zy+6P9q
Z+H5qm8r0wIDAQAB
-----END PUBLIC KEY-----`;

const MOCK_EMREX_ENDPOINT = process.env.MOCK_EMREX_ENDPOINT || `http://localhost:${PORT}/emrex`;

app.get('/certificates', async () => {
  console.log('[Mock EMREX] Certificate request received');
  return {
    ncps: [
      {
        url: MOCK_EMREX_ENDPOINT,
        pubKey: MOCK_PUBLIC_KEY,
      },
    ],
  };
});

// Start server
async function start() {
  try {
    await app.listen({ port: Number(PORT), host: '0.0.0.0' });
    console.log(`[Mock EMREX Provider] Running on port ${PORT}`);
    console.log(`[Mock EMREX Provider] Endpoint: http://localhost:${PORT}/emrex`);
    console.log(`[Mock EMREX Provider] Test API: http://localhost:${PORT}/test/*`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

start();

export { app, behavior };
