/**
 * Validation Script - Checks Elasticsearch for correct structured fields
 */

import * as http from 'http';

const ES_HOST = process.env.ES_HOST || 'localhost';
const ES_PORT = process.env.ES_PORT || '9200';
const INDEX_PATTERN = 'oots-structured-logs-*';

interface ValidationResult {
  scenario: string;
  passed: boolean;
  errors: string[];
  fields: Record<string, any>;
}

async function esQuery(query: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(query);
    const options = {
      hostname: ES_HOST,
      port: parseInt(ES_PORT),
      path: `/${INDEX_PATTERN}/_search`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function waitForElasticsearch(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await new Promise<any>((resolve, reject) => {
        http
          .get(`http://${ES_HOST}:${ES_PORT}/_cluster/health`, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve(JSON.parse(body)));
          })
          .on('error', reject);
      });
      if (response.status === 'green' || response.status === 'yellow') {
        return true;
      }
    } catch {
      // Ignore errors, keep trying
    }
    console.log(`Waiting for Elasticsearch... (${i + 1}/${maxAttempts})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function getDocumentByMsg(msg: string): Promise<any> {
  const response = await esQuery({
    query: { match: { msg: msg } },
    size: 1,
  });
  return response.hits?.hits?.[0]?._source;
}

function validateFields(doc: any, expected: Record<string, any>): string[] {
  const errors: string[] = [];

  for (const [path, expectedValue] of Object.entries(expected)) {
    const actualValue = getNestedValue(doc, path);

    if (expectedValue === undefined) {
      if (actualValue !== undefined) {
        errors.push(`${path}: expected undefined, got ${JSON.stringify(actualValue)}`);
      }
    } else if (actualValue === undefined) {
      errors.push(`${path}: missing (expected ${JSON.stringify(expectedValue)})`);
    } else if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      errors.push(`${path}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }

  return errors;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

async function validateScenario(
  name: string,
  msgMatch: string,
  expectedFields: Record<string, any>
): Promise<ValidationResult> {
  const doc = await getDocumentByMsg(msgMatch);

  if (!doc) {
    return {
      scenario: name,
      passed: false,
      errors: [`Document not found for msg: ${msgMatch}`],
      fields: {},
    };
  }

  const errors = validateFields(doc, expectedFields);

  return {
    scenario: name,
    passed: errors.length === 0,
    errors,
    fields: doc.oots || {},
  };
}

async function main() {
  console.log('OOTS Structured Logging Validation\n');
  console.log('='.repeat(60));

  // Wait for Elasticsearch
  console.log('\nWaiting for Elasticsearch...');
  const esReady = await waitForElasticsearch();
  if (!esReady) {
    console.error('Elasticsearch not available');
    process.exit(1);
  }
  console.log('Elasticsearch is ready.\n');

  // Wait a bit for Logstash to process
  console.log('Waiting for Logstash to process logs...');
  await new Promise((r) => setTimeout(r, 5000));

  // Check document count
  try {
    const countResponse = await esQuery({ query: { match_all: {} }, size: 0 });
    const count = countResponse.hits?.total?.value || 0;
    console.log(`Found ${count} documents in index.\n`);

    if (count === 0) {
      console.log('No documents found. Logstash may still be processing.');
      console.log('Try running validation again in a few seconds.');
      process.exit(1);
    }
  } catch (e) {
    console.log('Index not yet created. Waiting...');
    await new Promise((r) => setTimeout(r, 10000));
  }

  // Validate each scenario with comprehensive field checks
  const validations: Array<{ name: string; msg: string; expected: Record<string, any> }> = [
    {
      name: 'Initial Evidence Request',
      msg: 'Initial Evidence Request',
      expected: {
        // Core OOTS fields
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.request_id': 'urn:uuid:47867927-a7c8-40f2-93e4-4ad28f660094',
        'oots.request_time': '2025-10-27T07:36:02.113Z',
        'oots.procedure': 'T3',
        'oots.possibility_for_preview': true,
        'oots.explicit_request_given': true,
        'oots.message_type': 'request',

        // Evidence Requester
        'oots.er_name': 'Dienst Uitvoering Onderwijs',
        'oots.er_country': 'NL',
        'oots.er_identifier.scheme': 'urn:cef.eu:names:identifier:EAS:0106',
        'oots.er_identifier.value': '50973029',

        // Evidence Provider (EMREX)
        'oots.emrex_provider_name': 'EMREX - DUO NL',
        'oots.emrex_provider_identifier.scheme': 'urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL',
        'oots.emrex_provider_identifier.value': '00000001800866472000',

        // Evidence details
        'oots.evidence_title': 'Tertiary Education Diploma',
        'oots.evidence_format': 'application/pdf',
        'oots.evidence_type_id': '8387ddbc-3618-4584-9ebd-3060d56edb6a',
        'oots.evidence_type_classification':
          'https://sr.oots.tech.ec.europa.eu/evidencetypeclassifications/NL/fba698b1-4939-47a6-8445-4f6b8b94b60a',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-initial-001',
        'emrex.evidence_request_id': 'urn:uuid:47867927-a7c8-40f2-93e4-4ad28f660094',

        // ECS fields
        'event.action': 'evidence-request',
        'event.outcome': 'unknown',
      },
    },
    {
      name: 'Preview Request',
      msg: 'Preview Request',
      expected: {
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.state_id': 'e6479b2e-d324-4258-9a6b-907ac162b034',
        'oots.procedure': undefined, // Not present in preview requests
        'oots.message_type': 'request',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-preview-req-001',

        // ECS fields
        'event.action': 'evidence-request',
        'event.outcome': 'unknown',
      },
    },
    {
      name: 'Success Response WITH Evidence',
      msg: 'Success Response WITH Evidence',
      expected: {
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.result': 'Evidence delivered',
        'oots.response_id': '5af62cce-debe-11ec-9d64-0242ac120002',
        'oots.request_id_ref': 'urn:uuid:f10b7461-d144-4103-94d5-60f670d6632b',
        'oots.response_status': 'urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Success',
        'oots.response_issue_time': '2022-05-19T17:10:10.872Z',
        'oots.evidence_format': 'application/pdf',
        'oots.evidence_conforms_to':
          'https://sr.oots.tech.ec.europa.eu/evidencetypeclassifications/DK/958f8327-b9a9-4921-86dd-05800f136dfe',
        'oots.evidence_description': 'An official certificate of birth of a person',
        'oots.message_type': 'response',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-success-001',

        // ECS fields
        'event.action': 'evidence-response',
        'event.outcome': 'success',
        'event.reason': 'Evidence delivered',
      },
    },
    {
      name: 'Success Response WITHOUT Evidence',
      msg: 'Success Response WITHOUT Evidence',
      expected: {
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.result': 'No evidence delivered',
        'oots.response_status': 'urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Success',
        'oots.message_type': 'response',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-no-evidence-001',

        // ECS fields
        'event.action': 'evidence-response',
        'event.outcome': 'success',
        'event.reason': 'No evidence delivered',
      },
    },
    {
      name: 'Preview Required Response',
      msg: 'Preview Required Response',
      expected: {
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.result': 'Preview requested',
        'oots.state_id': 'e6479b2e-d324-4258-9a6b-907ac162b034',
        'oots.response_status': 'urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Failure',
        'oots.message_type': 'response',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-preview-resp-001',

        // ECS fields
        'event.action': 'evidence-response',
        'event.outcome': 'unknown',
        'event.reason': 'Preview requested',
      },
    },
    {
      name: 'Error Response',
      msg: 'Error Response',
      expected: {
        'oots.edm_version': 'oots-edm:v1.0',
        'oots.result': 'Error',
        'oots.response_status': 'urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Failure',
        'oots.message_type': 'response',

        // Error details
        'oots.error.exception_code': 'EDM:ERR:0008',
        'oots.error.exception_message': 'EMREX returned an error',
        'oots.error.exception_type': 'query:QueryExceptionType',
        'oots.error.exception_detail': 'No matching records found',

        // EMREX fields
        'emrex.conversationid': 'conv-001',
        'emrex.messageid': 'msg-error-001',

        // ECS error fields
        'error.code': 'EDM:ERR:0008',
        'error.message': 'EMREX returned an error',
        'error.type': 'query:QueryExceptionType',

        // ECS event fields
        'event.action': 'evidence-response',
        'event.outcome': 'failure',
        'event.reason': 'Error',
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const v of validations) {
    const result = await validateScenario(v.name, v.msg, v.expected);

    if (result.passed) {
      console.log(`✓ ${result.scenario}`);
      passed++;
    } else {
      console.log(`✗ ${result.scenario}`);
      for (const err of result.errors) {
        console.log(`    - ${err}`);
      }
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
