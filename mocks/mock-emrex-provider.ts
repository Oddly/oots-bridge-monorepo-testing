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
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const PORT = process.env.MOCK_EMREX_PORT || 9081;

// ============================================================================
// ECS-Compliant Structured Logging (matching OOTS Bridge format)
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type EventOutcome = 'success' | 'failure' | 'unknown';

interface LogFields {
  'event.action': string;
  'event.outcome'?: EventOutcome;
  'event.category'?: string[];
  'event.type'?: string[];
  'app.sessionId'?: string;
  'app.returnUrl'?: string;
  'app.returnCode'?: string;
  'app.behavior'?: string;
  'app.responseDelay'?: number;
  'app.bridgeResponseStatus'?: number;
  'app.targetUrl'?: string;
  'error.message'?: string;
  [key: string]: unknown;
}

function structuredLog(level: LogLevel, fields: LogFields): void {
  const severityMap: Record<LogLevel, { number: number; text: string }> = {
    debug: { number: 7, text: 'DEBUG' },
    info: { number: 13, text: 'INFO' },
    warn: { number: 17, text: 'WARN' },
    error: { number: 21, text: 'ERROR' },
  };

  const timestamp = new Date().toISOString();
  const logEntry = {
    'log.level': level,
    'severity.number': severityMap[level].number,
    'severity.text': severityMap[level].text,
    '@timestamp': timestamp,
    'log.logger': 'MOCK_EMREX',
    'event.created': timestamp,
    ...fields,
  };

  // Output as single-line JSON for Filebeat/Elasticsearch ingestion
  console.log(JSON.stringify(logEntry));
}

const logger = {
  debug: (fields: LogFields) => structuredLog('debug', fields),
  info: (fields: LogFields) => structuredLog('info', fields),
  warn: (fields: LogFields) => structuredLog('warn', fields),
  error: (fields: LogFields) => structuredLog('error', fields),
};

// Helper function to POST using Node's http/https modules (more reliable than native fetch in tsx)
function httpPost(
  targetUrl: string,
  body: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      // Skip TLS verification for self-signed certs in Docker
      rejectUnauthorized: false,
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: responseBody });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}
const BRIDGE_STORE_URL = process.env.BRIDGE_STORE_URL || 'http://localhost:3003/store';

// Rewrite localhost URLs to Docker network URLs when running in container
function rewriteUrlForDocker(url: string): string {
  // Check if we're in Docker (BRIDGE_STORE_URL will have container hostname)
  if (BRIDGE_STORE_URL.includes('bridge-proxy')) {
    // Rewrite to HTTPS via nginx proxy
    return url
      .replace('http://localhost:3003', 'https://bridge-proxy:443')
      .replace('https://localhost:3443', 'https://bridge-proxy:443');
  }
  if (BRIDGE_STORE_URL.includes('oots-bridge')) {
    return url.replace('localhost:3003', 'oots-bridge:3003');
  }
  return url;
}

const app = Fastify({ logger: false });

// Sample ELMO data (schema-compliant)
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
      <url>https://universityx.nl</url>
    </issuer>
    <learningOpportunitySpecification>
      <identifier type="local">DEGREE-001</identifier>
      <title xml:lang="en">Bachelor of Science in Computer Science</title>
      <type>Degree Programme</type>
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
    <issueDate>2021-06-30T00:00:00Z</issueDate>
  </report>
  <attachment>
    <type>Diploma</type>
    <content>JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PD4+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY4IDAwMDAwIG4gCjAwMDAwMDAxMjUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoyMjMKJSVFT0Y=</content>
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

// ELMO with mismatched identity (different name/DOB - schema-compliant)
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
      <url>https://universityx.nl</url>
    </issuer>
    <learningOpportunitySpecification>
      <identifier type="local">DEGREE-002</identifier>
      <title xml:lang="en">Bachelor of Arts</title>
      <type>Degree Programme</type>
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
    <issueDate>2021-06-30T00:00:00Z</issueDate>
  </report>
</elmo>`;

// Store endpoint redirect (simulates user completing EMREX flow)
app.get('/emrex', async (request, reply) => {
  const { sessionId, returnUrl } = request.query as { sessionId?: string; returnUrl?: string };

  logger.info({
    'event.action': 'emrex_redirect_received',
    'event.outcome': 'success',
    'event.category': ['web'],
    'event.type': ['access'],
    'app.sessionId': sessionId,
    'app.returnUrl': returnUrl,
  });

  if (!sessionId || !returnUrl) {
    return reply.code(400).send({ error: 'Missing sessionId or returnUrl' });
  }

  if (behavior === 'timeout') {
    logger.info({
      'event.action': 'emrex_timeout_simulation',
      'event.outcome': 'unknown',
      'event.category': ['web'],
      'event.type': ['info'],
      'app.sessionId': sessionId,
      'app.behavior': 'timeout',
    });
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

  // Rewrite URL for Docker networking
  const targetUrl = rewriteUrlForDocker(returnUrl);
  logger.info({
    'event.action': 'emrex_response_sending',
    'event.outcome': 'success',
    'event.category': ['web', 'network'],
    'event.type': ['connection', 'start'],
    'app.sessionId': sessionId,
    'app.returnCode': returnCode,
    'app.targetUrl': targetUrl,
    'app.behavior': behavior,
  });

  // POST to Bridge's /store endpoint (simulating the callback)
  try {
    const bodyParams = new URLSearchParams({
      sessionId,
      returnCode,
      ...(elmoData && { elmo: elmoData }),
      ...(returnMessage && { returnMessage }),
    });

    const response = await httpPost(targetUrl, bodyParams.toString());

    logger.info({
      'event.action': 'emrex_response_sent',
      'event.outcome': response.status >= 200 && response.status < 400 ? 'success' : 'failure',
      'event.category': ['web', 'network'],
      'event.type': ['connection', 'end'],
      'app.sessionId': sessionId,
      'app.returnCode': returnCode,
      'app.bridgeResponseStatus': response.status,
    });

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
    logger.error({
      'event.action': 'emrex_response_failed',
      'event.outcome': 'failure',
      'event.category': ['web', 'network'],
      'event.type': ['error'],
      'app.sessionId': sessionId,
      'app.returnCode': returnCode,
      'app.targetUrl': targetUrl,
      'error.message': error instanceof Error ? error.message : String(error),
    });
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

  logger.info({
    'event.action': 'emrex_behavior_changed',
    'event.outcome': 'success',
    'event.category': ['configuration'],
    'event.type': ['change'],
    'app.behavior': behavior,
    'app.responseDelay': responseDelay,
  });
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
  logger.info({
    'event.action': 'emrex_certificate_request',
    'event.outcome': 'success',
    'event.category': ['authentication'],
    'event.type': ['info'],
  });
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
    logger.info({
      'event.action': 'emrex_server_started',
      'event.outcome': 'success',
      'event.category': ['process'],
      'event.type': ['start'],
      'app.port': Number(PORT),
      'app.endpoint': `http://localhost:${PORT}/emrex`,
      'app.testApi': `http://localhost:${PORT}/test/*`,
    });
  } catch (err) {
    logger.error({
      'event.action': 'emrex_server_start_failed',
      'event.outcome': 'failure',
      'event.category': ['process'],
      'event.type': ['error'],
      'error.message': err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

start();

export { app, behavior };
