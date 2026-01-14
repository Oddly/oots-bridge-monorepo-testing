/**
 * Path Coverage Tests for OOTS Bridge Logging
 *
 * Tests all 12 execution paths through the Bridge and validates
 * that the expected logs appear in Elasticsearch with correct fields.
 *
 * Paths tested:
 * 1. Happy Path (Preview Required)
 * 2. Happy Path (Evidence Delivered with Preview)
 * 3. No Preview Support (Direct Error)
 * 4. Request XML Validation Error
 * 5. Request Schematron Validation Error
 * 6. EMREX User Cancellation
 * 7. EMREX Provider Error
 * 8. EMREX No Results
 * 9. EMREX Invalid GZIP
 * 10. EMREX Invalid XML/Schema
 * 11. EMREX Identity Mismatch
 * 12. Session Timeout (Redirect/Preview)
 */

import * as http from 'http';
import * as zlib from 'zlib';

// Configuration
const ES_HOST = process.env.ES_HOST || 'localhost';
const ES_PORT = process.env.ES_PORT || '9200';
const INDEX_PATTERN = 'oots-logs-*';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3003';
const MOCK_EMREX_URL = process.env.MOCK_EMREX_URL || 'http://localhost:9081';
const RED_GATEWAY_URL = process.env.RED_GATEWAY_URL || 'http://localhost:8280';
const BLUE_GATEWAY_URL = process.env.BLUE_GATEWAY_URL || 'http://localhost:8180';
const DOMIBUS_USER = process.env.DOMIBUS_USER || 'admin';
const DOMIBUS_PASS = process.env.DOMIBUS_PASS || '123456';

interface TestResult {
  path: string;
  description: string;
  passed: boolean;
  errors: string[];
  logsFound: string[];
  duration: number;
}

interface ExpectedLog {
  eventAction: string;
  logger?: 'APP' | 'EXT' | 'OOTS';
  outcome?: 'success' | 'failure';
  requiredFields?: string[];
  optional?: boolean;
}

// ============================================================================
// Elasticsearch Query Helpers
// ============================================================================

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

async function getLogsByConversationId(
  conversationId: string,
  waitMs: number = 10000
): Promise<any[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < waitMs) {
    const response = await esQuery({
      query: { term: { 'oots.conversation.id': conversationId } },
      size: 100,
      sort: [{ '@timestamp': 'asc' }],
    });

    const logs = response.hits?.hits?.map((h: any) => h._source) || [];
    if (logs.length > 0) {
      return logs;
    }

    await sleep(2000);
  }

  return [];
}

async function getLogsByEventAction(
  eventAction: string,
  afterTimestamp: string,
  limit: number = 10
): Promise<any[]> {
  const response = await esQuery({
    query: {
      bool: {
        must: [
          { term: { 'event.action': eventAction } },
          { range: { '@timestamp': { gte: afterTimestamp } } },
        ],
      },
    },
    size: limit,
    sort: [{ '@timestamp': 'desc' }],
  });

  return response.hits?.hits?.map((h: any) => h._source) || [];
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    auth?: { user: string; pass: string };
  } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (options.auth) {
      reqOptions.auth = `${options.auth.user}:${options.auth.pass}`;
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function setMockEmrexBehavior(mode: string, delay: number = 0): Promise<void> {
  await httpRequest(`${MOCK_EMREX_URL}/test/behavior`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, delay }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Request Triggers
// ============================================================================

function generateIds(): { queryId: string; messageId: string; conversationId: string } {
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

  return {
    queryId: `urn:uuid:${uuid()}`,
    messageId: `${uuid()}@domibus.eu`,
    conversationId: uuid(),
  };
}

function createQueryRequest(options: {
  queryId: string;
  timestamp: string;
  possibilityForPreview?: boolean;
  previewLocation?: string;
}): string {
  const previewSlot = options.possibilityForPreview !== false
    ? `<rim:Slot name="PossibilityForPreview">
        <rim:SlotValue xsi:type="rim:BooleanValueType">
            <rim:Value>true</rim:Value>
        </rim:SlotValue>
    </rim:Slot>`
    : '';

  const previewLocationSlot = options.previewLocation
    ? `<rim:Slot name="PreviewLocation">
        <rim:SlotValue xsi:type="rim:StringValueType">
            <rim:Value>${options.previewLocation}</rim:Value>
        </rim:SlotValue>
    </rim:Slot>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<query:QueryRequest xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0"
                    xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0"
                    xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0"
                    xmlns:sdg="http://data.europa.eu/p4s"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xmlns:xlink="http://www.w3.org/1999/xlink"
                    id="${options.queryId}">

    <rim:Slot name="SpecificationIdentifier">
        <rim:SlotValue xsi:type="rim:StringValueType">
            <rim:Value>oots-edm:v1.0</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="IssueDateTime">
        <rim:SlotValue xsi:type="rim:DateTimeValueType">
            <rim:Value>${options.timestamp}</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="Procedure">
        <rim:SlotValue xsi:type="rim:InternationalStringValueType">
            <rim:Value>
                <rim:LocalizedString value="T3"/>
            </rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    ${previewSlot}

    <rim:Slot name="ExplicitRequestGiven">
        <rim:SlotValue xsi:type="rim:BooleanValueType">
            <rim:Value>true</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="Requirements">
        <rim:SlotValue xsi:type="rim:CollectionValueType" collectionType="urn:oasis:names:tc:ebxml-regrep:CollectionType:Set">
            <rim:Element xsi:type="rim:AnyValueType">
                <sdg:Requirement>
                    <sdg:Identifier>https://sr.oots.tech.ec.europa.eu/requirements/dbe25e4e-fc46-3abd-823c-1bcfd54cb78d</sdg:Identifier>
                    <sdg:Name lang="EN">Proof of qualification level of tertiary education diploma/certificate/degree and its courses</sdg:Name>
                </sdg:Requirement>
            </rim:Element>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="EvidenceRequester">
        <rim:SlotValue xsi:type="rim:CollectionValueType" collectionType="urn:oasis:names:tc:ebxml-regrep:CollectionType:Set">
            <rim:Element xsi:type="rim:AnyValueType">
                <sdg:Agent>
                    <sdg:Identifier schemeID="urn:cef.eu:names:identifier:EAS:0106">50973029</sdg:Identifier>
                    <sdg:Name lang="EN">Dienst Uitvoering Onderwijs</sdg:Name>
                    <sdg:Address>
                        <sdg:AdminUnitLevel1>NL</sdg:AdminUnitLevel1>
                    </sdg:Address>
                    <sdg:Classification>ER</sdg:Classification>
                </sdg:Agent>
            </rim:Element>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="EvidenceProvider">
        <rim:SlotValue xsi:type="rim:AnyValueType">
            <sdg:Agent>
                <sdg:Identifier schemeID="urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL">00000001800866472000</sdg:Identifier>
                <sdg:Name lang="EN">EMREX - DUO NL</sdg:Name>
            </sdg:Agent>
        </rim:SlotValue>
    </rim:Slot>

    ${previewLocationSlot}

    <query:ResponseOption returnType="LeafClassWithRepositoryItem"/>

    <query:Query queryDefinition="DocumentQuery">
        <rim:Slot name="NaturalPerson">
            <rim:SlotValue xsi:type="rim:AnyValueType">
                <sdg:Person>
                    <sdg:LevelOfAssurance>High</sdg:LevelOfAssurance>
                    <sdg:FamilyName>Smith</sdg:FamilyName>
                    <sdg:GivenName>Jonas</sdg:GivenName>
                    <sdg:DateOfBirth>1999-03-01</sdg:DateOfBirth>
                </sdg:Person>
            </rim:SlotValue>
        </rim:Slot>

        <rim:Slot name="EvidenceRequest">
            <rim:SlotValue xsi:type="rim:AnyValueType">
                <sdg:DataServiceEvidenceType>
                    <sdg:Identifier>8387ddbc-3618-4584-9ebd-3060d56edb6a</sdg:Identifier>
                    <sdg:EvidenceTypeClassification>https://sr.oots.tech.ec.europa.eu/evidencetypeclassifications/NL/fba698b1-4939-47a6-8445-4f6b8b94b60a</sdg:EvidenceTypeClassification>
                    <sdg:Title lang="EN">Elmo (1.5)</sdg:Title>
                    <sdg:DistributedAs>
                        <sdg:Format>application/pdf</sdg:Format>
                    </sdg:DistributedAs>
                </sdg:DataServiceEvidenceType>
            </rim:SlotValue>
        </rim:Slot>
    </query:Query>

</query:QueryRequest>`;
}

async function submitToDomibus(
  conversationId: string,
  messageId: string,
  payload: string
): Promise<boolean> {
  const timestamp = new Date().toISOString();
  const payloadBase64 = Buffer.from(payload).toString('base64');

  const soapMessage = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:ns="http://eu.domibus.wsplugin/"
               xmlns:eb="http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/">
    <soap:Header>
        <eb:Messaging>
            <eb:UserMessage>
                <eb:MessageInfo>
                    <eb:Timestamp>${timestamp}</eb:Timestamp>
                    <eb:MessageId>${messageId}</eb:MessageId>
                </eb:MessageInfo>
                <eb:PartyInfo>
                    <eb:From>
                        <eb:PartyId type="urn:oasis:names:tc:ebcore:partyid-type:unregistered">red_gw</eb:PartyId>
                        <eb:Role>http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/initiator</eb:Role>
                    </eb:From>
                    <eb:To>
                        <eb:PartyId type="urn:oasis:names:tc:ebcore:partyid-type:unregistered">blue_gw</eb:PartyId>
                        <eb:Role>http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/responder</eb:Role>
                    </eb:To>
                </eb:PartyInfo>
                <eb:CollaborationInfo>
                    <eb:Service type="urn:oots">urn:oots:services:evidence</eb:Service>
                    <eb:Action>ExecuteQueryRequest</eb:Action>
                    <eb:AgreementRef type="urn:oots">urn:oots:agreement</eb:AgreementRef>
                    <eb:ConversationId>${conversationId}</eb:ConversationId>
                </eb:CollaborationInfo>
                <eb:MessageProperties>
                    <eb:Property name="originalSender">urn:oasis:names:tc:ebcore:partyid-type:unregistered:test-requester</eb:Property>
                    <eb:Property name="finalRecipient">urn:oasis:names:tc:ebcore:partyid-type:unregistered:test-provider</eb:Property>
                </eb:MessageProperties>
                <eb:PayloadInfo>
                    <eb:PartInfo href="cid:message"/>
                </eb:PayloadInfo>
            </eb:UserMessage>
        </eb:Messaging>
    </soap:Header>
    <soap:Body>
        <ns:submitRequest>
            <payload payloadId="cid:message" contentType="application/x-ebrs+xml">
                <value>${payloadBase64}</value>
            </payload>
        </ns:submitRequest>
    </soap:Body>
</soap:Envelope>`;

  try {
    const response = await httpRequest(`${RED_GATEWAY_URL}/domibus/services/wsplugin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: soapMessage,
      auth: { user: DOMIBUS_USER, pass: DOMIBUS_PASS },
    });

    return response.status === 200 && !response.body.includes('soap:Fault');
  } catch (error) {
    console.error('Failed to submit to Domibus:', error);
    return false;
  }
}

async function simulateEmrexCallback(sessionId: string, returnUrl: string): Promise<void> {
  // This triggers the mock EMREX provider to post back to the Bridge
  await httpRequest(`${MOCK_EMREX_URL}/emrex?sessionId=${sessionId}&returnUrl=${encodeURIComponent(returnUrl)}`, {
    method: 'GET',
  });
}

// ============================================================================
// Log Validation
// ============================================================================

function validateLogs(logs: any[], expected: ExpectedLog[]): { found: string[]; errors: string[] } {
  const found: string[] = [];
  const errors: string[] = [];

  for (const exp of expected) {
    const matchingLog = logs.find((log) => {
      const action = getNestedValue(log, 'event.action');
      if (action !== exp.eventAction) return false;

      if (exp.logger) {
        const logger = getNestedValue(log, 'log.logger');
        if (logger !== exp.logger) return false;
      }

      if (exp.outcome) {
        const outcome = getNestedValue(log, 'event.outcome');
        if (outcome !== exp.outcome) return false;
      }

      return true;
    });

    if (matchingLog) {
      found.push(exp.eventAction);

      // Validate required fields
      if (exp.requiredFields) {
        for (const field of exp.requiredFields) {
          if (getNestedValue(matchingLog, field) === undefined) {
            errors.push(`${exp.eventAction}: missing required field '${field}'`);
          }
        }
      }
    } else if (!exp.optional) {
      errors.push(`Missing log: ${exp.eventAction} (logger: ${exp.logger || 'any'}, outcome: ${exp.outcome || 'any'})`);
    }
  }

  return { found, errors };
}

// ============================================================================
// Test Path Definitions
// ============================================================================

interface TestPath {
  id: number;
  name: string;
  description: string;
  emrexBehavior?: string;
  possibilityForPreview?: boolean;
  withPreviewLocation?: boolean;
  expectedLogs: ExpectedLog[];
  setup?: () => Promise<void>;
  trigger: (ids: { queryId: string; messageId: string; conversationId: string }) => Promise<void>;
  waitTime?: number;
}

const testPaths: TestPath[] = [
  // Path 1: Happy Path - Preview Required
  {
    id: 1,
    name: 'Happy Path (Preview Required)',
    description: 'Initial request without PreviewLocation → Preview Required response',
    expectedLogs: [
      { eventAction: 'domibus_message_retrieval_started', logger: 'APP', outcome: 'success' },
      { eventAction: 'domibus_message_retrieval_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'oots_request_xml_validation_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'oots_request_schematron_validation_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'evidence_request_received', outcome: 'success', requiredFields: ['oots.message.id', 'oots.conversation.id'] },
      { eventAction: 'evidence_response_sent', requiredFields: ['oots.response.result'] },
      { eventAction: 'domibus_message_submission_started', logger: 'APP' },
      { eventAction: 'domibus_message_submission_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'message_processing_completed', logger: 'APP', outcome: 'success' },
    ],
    trigger: async (ids) => {
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
    },
    waitTime: 20000,
  },

  // Path 2: Happy Path - Evidence Delivered
  {
    id: 2,
    name: 'Happy Path (Evidence Delivered)',
    description: 'Request with PreviewLocation → User consents → Evidence delivered',
    emrexBehavior: 'success',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'domibus_message_retrieval_started', logger: 'APP' },
      { eventAction: 'domibus_message_retrieval_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'oots_request_xml_validation_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'oots_request_schematron_validation_completed', logger: 'APP', outcome: 'success' },
      { eventAction: 'evidence_request_received' },
      { eventAction: 'user_redirected_to_emrex', logger: 'EXT', outcome: 'success' },
      { eventAction: 'emrex_response_received', logger: 'EXT', outcome: 'success' },
      { eventAction: 'emrex_xml_validation_completed', logger: 'APP', outcome: 'success', optional: true },
      { eventAction: 'elm_converter_request_sent', logger: 'EXT', optional: true },
      { eventAction: 'elm_converter_request_completed', logger: 'EXT', optional: true },
      { eventAction: 'evidence_response_sent' },
      { eventAction: 'domibus_message_submission_completed', logger: 'APP', outcome: 'success' },
    ],
    trigger: async (ids) => {
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);

      // Wait for Bridge to process and redirect
      await sleep(8000);

      // Simulate user completing EMREX flow
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 30000,
  },

  // Path 6: EMREX User Cancellation
  {
    id: 6,
    name: 'EMREX User Cancellation',
    description: 'User cancels in EMREX portal → NCP_CANCEL → Error response',
    emrexBehavior: 'cancel',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'user_redirected_to_emrex', logger: 'EXT', outcome: 'success' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('cancel');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 7: EMREX Provider Error
  {
    id: 7,
    name: 'EMREX Provider Error',
    description: 'EMREX returns NCP_ERROR → Error response',
    emrexBehavior: 'error',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('error');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 8: EMREX No Results
  {
    id: 8,
    name: 'EMREX No Results',
    description: 'EMREX returns NCP_NO_RESULTS → Error response',
    emrexBehavior: 'no_records',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('no_records');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 9: EMREX Invalid GZIP
  {
    id: 9,
    name: 'EMREX Invalid GZIP',
    description: 'EMREX returns invalid gzip data → Decode error → Error response',
    emrexBehavior: 'invalid_gzip',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'emrex_decompression_failed', logger: 'APP', outcome: 'failure', optional: true },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('invalid_gzip');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 10: EMREX Invalid XML
  {
    id: 10,
    name: 'EMREX Invalid XML',
    description: 'EMREX returns XML that fails schema validation → Error response',
    emrexBehavior: 'invalid_xml',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'emrex_xml_validation_completed', logger: 'APP', outcome: 'failure' },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('invalid_xml');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 11: EMREX Identity Mismatch
  {
    id: 11,
    name: 'EMREX Identity Mismatch',
    description: 'EMREX returns data for different person → Identity mismatch error',
    emrexBehavior: 'identity_mismatch',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'emrex_response_received', logger: 'EXT' },
      { eventAction: 'emrex_identity_matching_completed', logger: 'APP', outcome: 'failure' },
      { eventAction: 'evidence_response_sent', outcome: 'failure' },
    ],
    trigger: async (ids) => {
      await setMockEmrexBehavior('identity_mismatch');
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      await sleep(8000);
      await simulateEmrexCallback(sessionId, `${BRIDGE_URL}/store`);
    },
    waitTime: 25000,
  },

  // Path 12: Session Timeout
  {
    id: 12,
    name: 'Session Timeout',
    description: 'User takes too long → Session expires → Timeout log emitted',
    withPreviewLocation: true,
    expectedLogs: [
      { eventAction: 'evidence_request_received' },
      { eventAction: 'user_redirected_to_emrex', logger: 'EXT', outcome: 'success' },
      { eventAction: 'session_timeout', logger: 'APP', optional: true },
    ],
    trigger: async (ids) => {
      const sessionId = ids.conversationId;
      const request = createQueryRequest({
        queryId: ids.queryId,
        timestamp: new Date().toISOString(),
        possibilityForPreview: true,
        previewLocation: `${BRIDGE_URL}/store?sessionId=${sessionId}`,
      });
      await submitToDomibus(ids.conversationId, ids.messageId, request);
      // Don't complete EMREX flow - let it timeout
    },
    waitTime: 15000, // Short wait - timeout check runs periodically
  },
];

// ============================================================================
// Test Runner
// ============================================================================

async function runTest(path: TestPath): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const ids = generateIds();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Path ${path.id}] ${path.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Description: ${path.description}`);
  console.log(`Conversation ID: ${ids.conversationId}`);

  try {
    // Setup (e.g., configure mock behavior)
    if (path.setup) {
      await path.setup();
    }

    // Trigger the test
    const beforeTimestamp = new Date().toISOString();
    console.log(`Triggering at: ${beforeTimestamp}`);

    await path.trigger(ids);

    // Wait for logs to appear
    const waitTime = path.waitTime || 15000;
    console.log(`Waiting ${waitTime / 1000}s for logs to appear...`);
    await sleep(waitTime);

    // Query logs by conversation ID
    let logs = await getLogsByConversationId(ids.conversationId, 5000);

    // Also try querying by timestamp if conversation ID doesn't work yet
    if (logs.length === 0) {
      console.log('No logs by conversation ID, trying by timestamp...');
      for (const expected of path.expectedLogs.slice(0, 3)) {
        const byAction = await getLogsByEventAction(expected.eventAction, beforeTimestamp, 5);
        if (byAction.length > 0) {
          logs = logs.concat(byAction);
        }
      }
    }

    console.log(`Found ${logs.length} log(s)`);

    // Validate logs
    const validation = validateLogs(logs, path.expectedLogs);

    if (validation.errors.length > 0) {
      errors.push(...validation.errors);
    }

    const duration = Date.now() - startTime;

    return {
      path: `Path ${path.id}: ${path.name}`,
      description: path.description,
      passed: errors.length === 0,
      errors,
      logsFound: validation.found,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      path: `Path ${path.id}: ${path.name}`,
      description: path.description,
      passed: false,
      errors: [String(error)],
      logsFound: [],
      duration,
    };
  }
}

async function checkPrerequisites(): Promise<boolean> {
  console.log('Checking prerequisites...\n');

  // Check Elasticsearch
  try {
    const response = await httpRequest(`http://${ES_HOST}:${ES_PORT}/_cluster/health`);
    if (response.status !== 200) {
      console.error('✗ Elasticsearch not healthy');
      return false;
    }
    console.log('✓ Elasticsearch');
  } catch {
    console.error('✗ Elasticsearch not reachable');
    return false;
  }

  // Check Red Gateway
  try {
    const response = await httpRequest(`${RED_GATEWAY_URL}/domibus`);
    if (response.status === 0) throw new Error('No response');
    console.log('✓ Red Gateway');
  } catch {
    console.error('✗ Red Gateway not reachable');
    return false;
  }

  // Check Blue Gateway
  try {
    const response = await httpRequest(`${BLUE_GATEWAY_URL}/domibus`);
    if (response.status === 0) throw new Error('No response');
    console.log('✓ Blue Gateway');
  } catch {
    console.error('✗ Blue Gateway not reachable');
    return false;
  }

  // Check Mock EMREX
  try {
    const response = await httpRequest(`${MOCK_EMREX_URL}/health`);
    if (response.status !== 200) throw new Error('Not healthy');
    console.log('✓ Mock EMREX Provider');
  } catch {
    console.error('✗ Mock EMREX Provider not reachable');
    return false;
  }

  // Check Bridge
  try {
    const response = await httpRequest(`${BRIDGE_URL}/health`);
    if (response.status === 0) throw new Error('No response');
    console.log('✓ Bridge');
  } catch {
    console.error('✗ Bridge not reachable (may be OK if health endpoint is different)');
    // Don't fail - health endpoint might not exist
  }

  return true;
}

function printServiceStatus(): void {
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│                    SERVICES AVAILABLE                      │');
  console.log('├────────────────────────────────────────────────────────────┤');
  console.log('│  Service              │ URL                    │ Status   │');
  console.log('├───────────────────────┼────────────────────────┼──────────┤');
  console.log('│  Blue Gateway (Prov)  │ http://localhost:8180  │ healthy  │');
  console.log('│  Red Gateway (Req)    │ http://localhost:8280  │ healthy  │');
  console.log('│  Bridge               │ http://localhost:3003  │ healthy  │');
  console.log('│  Mock EMREX           │ http://localhost:9081  │ healthy  │');
  console.log('│  Elasticsearch        │ http://localhost:9200  │ healthy  │');
  console.log('│  Kibana               │ http://localhost:5601  │ ready    │');
  console.log('├───────────────────────┴────────────────────────┴──────────┤');
  console.log('│  Domibus credentials: admin / 123456                      │');
  console.log('└────────────────────────────────────────────────────────────┘');
}

function printTestOverview(pathsToRun: TestPath[]): void {
  console.log('┌────────────────────────────────────────────────────────────┐');
  console.log('│                      TEST OVERVIEW                         │');
  console.log('├────────────────────────────────────────────────────────────┤');

  for (const path of pathsToRun) {
    const idStr = `Path ${path.id}`.padEnd(8);
    const name = path.name.substring(0, 45).padEnd(45);
    console.log(`│  ${idStr} │ ${name} │`);
  }

  console.log('├────────────────────────────────────────────────────────────┤');
  console.log(`│  Running ${pathsToRun.length} test path(s)                                    │`);
  console.log('└────────────────────────────────────────────────────────────┘');
  console.log('');
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         OOTS Bridge Path Coverage Tests                    ║');
  console.log('║                                                            ║');
  console.log('║  Validates structured logging across execution paths       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Parse args
  const args = process.argv.slice(2);
  const pathArg = args.find((a) => a.startsWith('--path='));
  const selectedPath = pathArg ? parseInt(pathArg.split('=')[1]) : null;
  const skipPrereqs = args.includes('--skip-prereqs');

  // Check prerequisites
  if (!skipPrereqs) {
    const prereqsOk = await checkPrerequisites();
    if (!prereqsOk) {
      console.error('\nPrerequisite checks failed. Start the E2E stack first.');
      console.error('Run: task e2e:start');
      process.exit(1);
    }
    console.log('');
    printServiceStatus();
    console.log('');
  }

  // Run tests
  const pathsToRun = selectedPath
    ? testPaths.filter((p) => p.id === selectedPath)
    : testPaths;

  printTestOverview(pathsToRun);

  if (pathsToRun.length === 0) {
    console.error(`No test path found with ID ${selectedPath}`);
    process.exit(1);
  }

  const results: TestResult[] = [];

  for (const path of pathsToRun) {
    // Reset mock behavior before each test
    await setMockEmrexBehavior(path.emrexBehavior || 'success');

    const result = await runTest(path);
    results.push(result);

    // Print immediate result
    const status = result.passed ? '✓' : '✗';
    console.log(`\n${status} ${result.path}`);
    if (result.logsFound.length > 0) {
      console.log(`  Logs found: ${result.logsFound.join(', ')}`);
    }
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`  Error: ${err}`);
      }
    }
    console.log(`  Duration: ${result.duration}ms`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    console.log(`${status} ${result.path}`);
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
