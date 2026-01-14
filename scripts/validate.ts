/**
 * Validation Script - Checks Elasticsearch for correct structured fields
 */

import * as http from 'http';

const ES_HOST = process.env.ES_HOST || 'localhost';
const ES_PORT = process.env.ES_PORT || '9200';
const INDEX_PATTERN = 'oots-logs-*';

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

async function getDocumentByEventAction(eventAction: string): Promise<any> {
  const response = await esQuery({
    query: { term: { 'event.action': eventAction } },
    size: 1,
    sort: [{ '@timestamp': 'desc' }],
  });
  return response.hits?.hits?.[0]?._source;
}

async function getDocumentsByConversationId(conversationId: string): Promise<any[]> {
  const response = await esQuery({
    query: { term: { 'oots.conversation.id': conversationId } },
    size: 100,
    sort: [{ '@timestamp': 'asc' }],
  });
  return response.hits?.hits?.map((h: any) => h._source) || [];
}

async function getAppLogsByOperation(operation: string): Promise<any[]> {
  const response = await esQuery({
    query: {
      bool: {
        must: [
          { term: { 'log.logger': 'APP' } },
          { term: { 'event.action': operation } },
        ],
      },
    },
    size: 10,
    sort: [{ '@timestamp': 'desc' }],
  });
  return response.hits?.hits?.map((h: any) => h._source) || [];
}

async function getExtLogsByOperation(operation: string): Promise<any[]> {
  const response = await esQuery({
    query: {
      bool: {
        must: [
          { term: { 'log.logger': 'EXT' } },
          { term: { 'event.action': operation } },
        ],
      },
    },
    size: 10,
    sort: [{ '@timestamp': 'desc' }],
  });
  return response.hits?.hits?.map((h: any) => h._source) || [];
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

  let passed = 0;
  let failed = 0;

  // ==========================================================================
  // OOTS LOG VALIDATIONS (Evidence Request/Response logs)
  // ==========================================================================
  console.log('\n--- OOTS Logs (Evidence Request/Response) ---\n');

  // Find evidence request logs by event.action
  const evidenceRequestDoc = await getDocumentByEventAction('evidence_request_received');
  if (evidenceRequestDoc) {
    const errors = validateFields(evidenceRequestDoc, {
      // OpenTelemetry fields
      'messaging.system': 'domibus',
      'messaging.operation': 'receive',

      // ECS Event fields
      'event.action': 'evidence_request_received',
      'event.outcome': 'success',

      // OOTS Business Context
      'oots.message.type': 'QueryRequest',
    });

    // Check for presence of key fields (values vary)
    const requiredFields = [
      'trace.id',
      'oots.message.id',
      'oots.conversation.id',
      'oots.request.id',
      'oots.non_repudiation',
    ];
    for (const field of requiredFields) {
      if (getNestedValue(evidenceRequestDoc, field) === undefined) {
        errors.push(`${field}: required field missing`);
      }
    }

    if (errors.length === 0) {
      console.log('✓ Evidence Request Log (OOTS)');
      passed++;
    } else {
      console.log('✗ Evidence Request Log (OOTS)');
      for (const err of errors) {
        console.log(`    - ${err}`);
      }
      failed++;
    }
  } else {
    console.log('✗ Evidence Request Log (OOTS) - No document found');
    failed++;
  }

  // Find evidence response logs by event.action
  const evidenceResponseDoc = await getDocumentByEventAction('evidence_response_sent');
  if (evidenceResponseDoc) {
    const errors = validateFields(evidenceResponseDoc, {
      // OpenTelemetry fields
      'messaging.system': 'domibus',
      'messaging.operation': 'publish',

      // ECS Event fields
      'event.action': 'evidence_response_sent',

      // OOTS Business Context
      'oots.message.type': 'QueryResponse',
    });

    // Check for presence of key fields
    const requiredFields = [
      'trace.id',
      'oots.message.id',
      'oots.conversation.id',
      'oots.response.result',
      'oots.non_repudiation',
    ];
    for (const field of requiredFields) {
      if (getNestedValue(evidenceResponseDoc, field) === undefined) {
        errors.push(`${field}: required field missing`);
      }
    }

    if (errors.length === 0) {
      console.log('✓ Evidence Response Log (OOTS)');
      passed++;
    } else {
      console.log('✗ Evidence Response Log (OOTS)');
      for (const err of errors) {
        console.log(`    - ${err}`);
      }
      failed++;
    }
  } else {
    console.log('✗ Evidence Response Log (OOTS) - No document found');
    failed++;
  }

  // ==========================================================================
  // APP LOG VALIDATIONS (Internal application operations)
  // ==========================================================================
  console.log('\n--- APP Logs (Internal Operations) ---\n');

  const appLogValidations = [
    {
      name: 'Domibus Message Retrieval Started',
      eventAction: 'domibus_message_retrieval_started',
      requiredFields: ['trace.id', 'event.outcome', 'event.category', 'event.type'],
    },
    {
      name: 'Domibus Message Retrieval Completed',
      eventAction: 'domibus_message_retrieval_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'OOTS Request XML Validation',
      eventAction: 'oots_request_xml_validation_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'OOTS Request Schematron Validation',
      eventAction: 'oots_request_schematron_validation_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'Domibus Message Submission Started',
      eventAction: 'domibus_message_submission_started',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'Domibus Message Submission Completed',
      eventAction: 'domibus_message_submission_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'Message Processing Completed',
      eventAction: 'message_processing_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
  ];

  for (const v of appLogValidations) {
    const docs = await getAppLogsByOperation(v.eventAction);
    if (docs.length > 0) {
      const doc = docs[0];
      const errors: string[] = [];

      // Check log.logger is APP (use getNestedValue for nested objects)
      const logLogger = getNestedValue(doc, 'log.logger');
      if (logLogger !== 'APP') {
        errors.push(`log.logger: expected 'APP', got '${logLogger}'`);
      }

      // Check required fields are present
      for (const field of v.requiredFields) {
        if (getNestedValue(doc, field) === undefined) {
          errors.push(`${field}: required field missing`);
        }
      }

      if (errors.length === 0) {
        console.log(`✓ ${v.name}`);
        passed++;
      } else {
        console.log(`✗ ${v.name}`);
        for (const err of errors) {
          console.log(`    - ${err}`);
        }
        failed++;
      }
    } else {
      console.log(`○ ${v.name} - No document found (may not be triggered)`);
      // Don't count as failed - may not be triggered in this test
    }
  }

  // ==========================================================================
  // EXT LOG VALIDATIONS (External system interactions)
  // ==========================================================================
  console.log('\n--- EXT Logs (External Interactions) ---\n');

  const extLogValidations = [
    {
      name: 'User Redirected to EMREX',
      eventAction: 'user_redirected_to_emrex',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'EMREX Response Received',
      eventAction: 'emrex_response_received',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'ELM Converter Request Sent',
      eventAction: 'elm_converter_request_sent',
      requiredFields: ['trace.id', 'event.outcome'],
    },
    {
      name: 'ELM Converter Request Completed',
      eventAction: 'elm_converter_request_completed',
      requiredFields: ['trace.id', 'event.outcome'],
    },
  ];

  for (const v of extLogValidations) {
    const docs = await getExtLogsByOperation(v.eventAction);
    if (docs.length > 0) {
      const doc = docs[0];
      const errors: string[] = [];

      // Check log.logger is EXT (use getNestedValue for nested objects)
      const logLogger = getNestedValue(doc, 'log.logger');
      if (logLogger !== 'EXT') {
        errors.push(`log.logger: expected 'EXT', got '${logLogger}'`);
      }

      // Check required fields are present
      for (const field of v.requiredFields) {
        if (getNestedValue(doc, field) === undefined) {
          errors.push(`${field}: required field missing`);
        }
      }

      if (errors.length === 0) {
        console.log(`✓ ${v.name}`);
        passed++;
      } else {
        console.log(`✗ ${v.name}`);
        for (const err of errors) {
          console.log(`    - ${err}`);
        }
        failed++;
      }
    } else {
      console.log(`○ ${v.name} - No document found (may not be triggered)`);
      // Don't count as failed - may not be triggered in this test
    }
  }

  // Legacy OOTS log validations (for backward compatibility with generate-logs.ts)
  // These use 'msg' field matching for manually generated test data
  // Skip these in E2E mode - they're only relevant for generate-logs.ts test data
  const skipLegacyValidations = process.env.SKIP_LEGACY !== 'false';
  if (skipLegacyValidations) {
    console.log('\n--- Legacy OOTS Log Scenarios (skipped - set SKIP_LEGACY=false to enable) ---\n');
  } else {
    console.log('\n--- Legacy OOTS Log Scenarios (from generate-logs.ts) ---\n');
  }

  const validations: Array<{ name: string; msg: string; expected: Record<string, any> }> = [
    {
      name: 'Initial Evidence Request (Legacy)',
      msg: 'Initial Evidence Request',
      expected: {
        'event.action': 'evidence_request_received',
        'event.outcome': 'success',
        'oots.message.type': 'QueryRequest',
        'messaging.system': 'domibus',
        'messaging.operation': 'receive',
      },
    },
    {
      name: 'Preview Request (Legacy)',
      msg: 'Preview Request',
      expected: {
        'event.action': 'evidence_request_received',
        'oots.message.type': 'QueryRequest',
        'oots.transaction.phase': 'preview_request',
      },
    },
    {
      name: 'Success Response WITH Evidence (Legacy)',
      msg: 'Success Response WITH Evidence',
      expected: {
        'event.action': 'evidence_response_sent',
        'event.outcome': 'success',
        'oots.message.type': 'QueryResponse',
        'oots.response.result': 'evidence_delivered',
      },
    },
    {
      name: 'Preview Required Response (Legacy)',
      msg: 'Preview Required Response',
      expected: {
        'event.action': 'evidence_response_sent',
        'oots.message.type': 'QueryResponse',
        'oots.response.result': 'preview_requested',
      },
    },
    {
      name: 'Error Response (Legacy)',
      msg: 'Error Response',
      expected: {
        'event.action': 'evidence_response_sent',
        'event.outcome': 'failure',
        'oots.message.type': 'QueryResponse',
        'oots.response.result': 'error',
      },
    },
  ];

  if (!skipLegacyValidations) {
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
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
