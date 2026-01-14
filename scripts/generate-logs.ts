/**
 * Log Generator - Produces all OOTS logging scenarios
 *
 * Generates NDJSON log files that simulate the bridge backend output,
 * including all variations of requests and responses.
 *
 * Imports directly from oots-bridge-monorepo to use the same code.
 */

import * as fs from 'fs';
import * as path from 'path';

// Import from the monorepo - keeps code in one place
import { createEvidenceRequestLog } from '../../oots-bridge-monorepo/apps/bridge/backend/src/utils/oots-logs/createEvidenceRequestLog.js';
import { createEvidenceResponseLog } from '../../oots-bridge-monorepo/apps/bridge/backend/src/utils/oots-logs/createEvidenceResponseLog.js';

const OUTPUT_FILE = path.join(import.meta.dirname, '../testdata/raw_logs.ndjson');

// ============================================================================
// TEST DATA: Requests
// ============================================================================

const initialRequest = {
  _attributes: {
    id: 'urn:uuid:47867927-a7c8-40f2-93e4-4ad28f660094',
  },
  Slot: [
    { _attributes: { name: 'SpecificationIdentifier' }, SlotValue: { Value: { _text: 'oots-edm:v1.0' } } },
    { _attributes: { name: 'IssueDateTime' }, SlotValue: { Value: { _text: '2025-10-27T08:36:02.113+01:00' } } },
    { _attributes: { name: 'Procedure' }, SlotValue: { Value: { LocalizedString: { _attributes: { value: 'T3' } } } } },
    { _attributes: { name: 'PossibilityForPreview' }, SlotValue: { Value: { _text: 'true' } } },
    { _attributes: { name: 'ExplicitRequestGiven' }, SlotValue: { Value: { _text: 'true' } } },
    {
      _attributes: { name: 'Requirements' },
      SlotValue: {
        Element: {
          Requirement: {
            Identifier: { _text: 'https://sr.oots.tech.ec.europa.eu/requirements/dbe25e4e-fc46-3abd-823c-1bcfd54cb78d' },
            Name: { _text: 'Proof of qualification level of tertiary education diploma', _attributes: { lang: 'EN' } },
          },
        },
      },
    },
    {
      _attributes: { name: 'EvidenceRequester' },
      SlotValue: {
        Element: {
          Agent: {
            Identifier: { _text: '50973029', _attributes: { schemeID: 'urn:cef.eu:names:identifier:EAS:0106' } },
            Name: { _text: 'Dienst Uitvoering Onderwijs', _attributes: { lang: 'EN' } },
            Address: { AdminUnitLevel1: { _text: 'NL' } },
            Classification: { _text: 'ER' },
          },
        },
      },
    },
    {
      _attributes: { name: 'EvidenceProvider' },
      SlotValue: {
        Agent: {
          Identifier: { _text: '00000001800866472000', _attributes: { schemeID: 'urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL' } },
          Name: { _text: 'EMREX - DUO NL', _attributes: { lang: 'EN' } },
        },
      },
    },
  ],
  Query: {
    _attributes: { queryDefinition: 'DocumentQuery' },
    Slot: [
      {
        _attributes: { name: 'NaturalPerson' },
        SlotValue: {
          Person: {
            LevelOfAssurance: { _text: 'High' },
            FamilyName: { _text: 'Smith' },
            GivenName: { _text: 'Jonas' },
            DateOfBirth: { _text: '1999-03-01' },
          },
        },
      },
      {
        _attributes: { name: 'EvidenceRequest' },
        SlotValue: {
          DataServiceEvidenceType: {
            Identifier: { _text: '8387ddbc-3618-4584-9ebd-3060d56edb6a' },
            EvidenceTypeClassification: { _text: 'https://sr.oots.tech.ec.europa.eu/evidencetypeclassifications/NL/fba698b1-4939-47a6-8445-4f6b8b94b60a' },
            Title: [
              { _text: 'Finnish Title', _attributes: { lang: 'FI' } },
              { _text: 'Tertiary Education Diploma', _attributes: { lang: 'EN' } },
            ],
            DistributedAs: { Format: { _text: 'application/pdf' } },
          },
        },
      },
    ],
  },
};

const previewRequest = {
  ...initialRequest,
  _attributes: { id: 'urn:uuid:preview-request-001' },
  Slot: [
    ...initialRequest.Slot,
    {
      _attributes: { name: 'PreviewLocation' },
      SlotValue: { Value: { _text: 'https://acc-gateway.rinis.nl/emrex/bridge-frontend?sessionId=e6479b2e-d324-4258-9a6b-907ac162b034' } },
    },
  ],
};

// ============================================================================
// TEST DATA: Responses (XML)
// ============================================================================

const successResponseXml = `<?xml version="1.0" encoding="utf-8"?>
<query:QueryResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0" xmlns:sdg="http://data.europa.eu/p4s" xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0" xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0" xmlns:xlink="http://www.w3.org/1999/xlink" status="urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Success" requestId="urn:uuid:f10b7461-d144-4103-94d5-60f670d6632b">
    <rim:Slot name="SpecificationIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>oots-edm:v1.0</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceResponseIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>5af62cce-debe-11ec-9d64-0242ac120002</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="IssueDateTime"><rim:SlotValue xsi:type="rim:DateTimeValueType"><rim:Value>2022-05-19T17:10:10.872Z</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceRequester"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:cef.eu:names:identifier:EAS:0106">50973029</sdg:Identifier><sdg:Name lang="EN">Dienst Uitvoering Onderwijs</sdg:Name></sdg:Agent></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceProvider"><rim:SlotValue xsi:type="rim:CollectionValueType"><rim:Element xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL">00000001800866472000</sdg:Identifier><sdg:Name lang="EN">EMREX - DUO NL</sdg:Name></sdg:Agent></rim:Element></rim:SlotValue></rim:Slot>
    <rim:RegistryObjectList>
        <rim:RegistryObject xsi:type="rim:ExtrinsicObjectType" id="urn:uuid:b7c630eb-6436-498e-9b66-abafa998f429">
            <rim:Slot name="EvidenceMetadata"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Evidence><sdg:Identifier>78a8d60e-13db-407e-af7a-0d93b093e1f2</sdg:Identifier><sdg:IsConformantTo><sdg:EvidenceTypeClassification>https://sr.oots.tech.ec.europa.eu/evidencetypeclassifications/DK/958f8327-b9a9-4921-86dd-05800f136dfe</sdg:EvidenceTypeClassification><sdg:Title lang="EN">Certificate of Birth</sdg:Title><sdg:Description lang="EN">An official certificate of birth of a person</sdg:Description></sdg:IsConformantTo><sdg:Distribution><sdg:Format>application/pdf</sdg:Format></sdg:Distribution></sdg:Evidence></rim:SlotValue></rim:Slot>
            <rim:RepositoryItemRef xlink:href="cid:98353b9f-c915-4590-9f6c-6a18692d0b88@example.oots.eu" xlink:title="Attachment #1"/>
        </rim:RegistryObject>
    </rim:RegistryObjectList>
</query:QueryResponse>`;

const successNoEvidenceXml = `<?xml version="1.0" encoding="utf-8"?>
<query:QueryResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:sdg="http://data.europa.eu/p4s" xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0" xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0" status="urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Success" requestId="urn:uuid:no-evidence-request">
    <rim:Slot name="SpecificationIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>oots-edm:v1.0</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceResponseIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>no-evidence-response-id</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceRequester"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:cef.eu:names:identifier:EAS:0106">50973029</sdg:Identifier></sdg:Agent></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceProvider"><rim:SlotValue xsi:type="rim:CollectionValueType"><rim:Element xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL">00000001800866472000</sdg:Identifier></sdg:Agent></rim:Element></rim:SlotValue></rim:Slot>
    <rim:RegistryObjectList><rim:RegistryObject xsi:type="rim:ExtrinsicObjectType" id="urn:uuid:empty-registry"/></rim:RegistryObjectList>
</query:QueryResponse>`;

const previewResponseXml = `<?xml version="1.0" encoding="utf-8"?>
<query:QueryResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0" xmlns:sdg="http://data.europa.eu/p4s" xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0" xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0" status="urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Failure" requestId="urn:uuid:47867927-a7c8-40f2-93e4-4ad28f660094">
    <rim:Slot name="SpecificationIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>oots-edm:v1.0</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceResponseIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>71c8f918-38d8-4306-ac86-1b928cacddb1</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceRequester"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:cef.eu:names:identifier:EAS:0106">50973029</sdg:Identifier></sdg:Agent></rim:SlotValue></rim:Slot>
    <rim:Slot name="ErrorProvider"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="urn:oasis:names:tc:ebcore:partyid-type:unregistered:NL">00000001800866472000</sdg:Identifier></sdg:Agent></rim:SlotValue></rim:Slot>
    <rs:Exception xsi:type="rs:AuthorizationExceptionType" severity="urn:sr.oots.tech.ec.europa.eu:codes:ErrorSeverity:EDMErrorResponse:PreviewRequired" message="Missing Authorization" detail="The server needs authorisation and preview" code="EDM:ERR:0002">
        <rim:Slot name="Timestamp"><rim:SlotValue xsi:type="rim:DateTimeValueType"><rim:Value>2025-10-27T07:36:06.336Z</rim:Value></rim:SlotValue></rim:Slot>
        <rim:Slot name="PreviewLocation"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>https://acc-gateway.rinis.nl/emrex/bridge-frontend?sessionId=e6479b2e-d324-4258-9a6b-907ac162b034</rim:Value></rim:SlotValue></rim:Slot>
    </rs:Exception>
</query:QueryResponse>`;

const errorResponseXml = `<?xml version="1.0" encoding="utf-8"?>
<query:QueryResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0" xmlns:sdg="http://data.europa.eu/p4s" xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0" xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0" status="urn:oasis:names:tc:ebxml-regrep:ResponseStatusType:Failure" requestId="urn:uuid:error-request">
    <rim:Slot name="SpecificationIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>oots-edm:v1.0</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceResponseIdentifier"><rim:SlotValue xsi:type="rim:StringValueType"><rim:Value>error-response-id</rim:Value></rim:SlotValue></rim:Slot>
    <rim:Slot name="EvidenceRequester"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="test-scheme">test-id</sdg:Identifier></sdg:Agent></rim:SlotValue></rim:Slot>
    <rim:Slot name="ErrorProvider"><rim:SlotValue xsi:type="rim:AnyValueType"><sdg:Agent><sdg:Identifier schemeID="provider-scheme">provider-id</sdg:Identifier></sdg:Agent></rim:SlotValue></rim:Slot>
    <rs:Exception xsi:type="query:QueryExceptionType" severity="urn:oasis:names:tc:ebxml-regrep:ErrorSeverityType:Error" message="EMREX returned an error" detail="No matching records found" code="EDM:ERR:0008">
        <rim:Slot name="Timestamp"><rim:SlotValue xsi:type="rim:DateTimeValueType"><rim:Value>2025-10-27T07:36:06.336Z</rim:Value></rim:SlotValue></rim:Slot>
    </rs:Exception>
</query:QueryResponse>`;

// ============================================================================
// LOG WRAPPER - Simulates Pino logger output format
// ============================================================================

interface LogEntry {
  level: number;
  time: number;
  pid: number;
  hostname: string;
  logger: string;
  msg: string;
  log: any;
}

function wrapAsLogEntry(logData: any, scenario: string): LogEntry {
  return {
    level: 30, // INFO level
    time: Date.now(),
    pid: process.pid,
    hostname: 'oots-bridge-test',
    logger: 'OOTS',
    msg: scenario,
    log: logData,
  };
}

// ============================================================================
// GENERATE ALL SCENARIOS
// ============================================================================

const scenarios: Array<{ name: string; log: any }> = [
  // Request scenarios
  {
    name: 'Initial Evidence Request',
    log: createEvidenceRequestLog(initialRequest, 'msg-initial-001', 'conv-001', '<xml>full-request-xml</xml>'),
  },
  {
    name: 'Preview Request (second request)',
    log: createEvidenceRequestLog(previewRequest, 'msg-preview-req-001', 'conv-001', '<xml>preview-request-xml</xml>'),
  },

  // Response scenarios
  {
    name: 'Success Response WITH Evidence',
    log: createEvidenceResponseLog(successResponseXml, 'msg-success-001', 'conv-001'),
  },
  {
    name: 'Success Response WITHOUT Evidence',
    log: createEvidenceResponseLog(successNoEvidenceXml, 'msg-no-evidence-001', 'conv-001'),
  },
  {
    name: 'Preview Required Response',
    log: createEvidenceResponseLog(previewResponseXml, 'msg-preview-resp-001', 'conv-001'),
  },
  {
    name: 'Error Response',
    log: createEvidenceResponseLog(errorResponseXml, 'msg-error-001', 'conv-001'),
  },
];

// ============================================================================
// MAIN
// ============================================================================

console.log('Generating OOTS structured logging test data...\n');

const outputLines: string[] = [];

for (const scenario of scenarios) {
  const entry = wrapAsLogEntry(scenario.log, scenario.name);
  outputLines.push(JSON.stringify(entry));
  console.log(`  - ${scenario.name}`);
  console.log(`    oots.result: ${scenario.log.oots?.result || 'N/A (request)'}`);
}

// Ensure testdata directory exists
const testdataDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(testdataDir)) {
  fs.mkdirSync(testdataDir, { recursive: true });
}

// Write NDJSON file
fs.writeFileSync(OUTPUT_FILE, outputLines.join('\n') + '\n');

console.log(`\nGenerated ${scenarios.length} log entries to: ${OUTPUT_FILE}`);
console.log('\nScenario summary:');
console.log('  Requests: 2 (initial + preview)');
console.log('  Responses: 4 (success+evidence, success-evidence, preview, error)');
