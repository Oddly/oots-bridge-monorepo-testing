/**
 * E2E Test Scenarios with Real Domibus
 *
 * Tests the full OOTS flow using real Domibus AS4 gateway:
 * 1. Submit OOTS QueryRequest to Domibus via WS Plugin
 * 2. Bridge polls Domibus and processes the request
 * 3. Bridge submits response back to Domibus
 * 4. Verify response in Domibus
 *
 * Prerequisites:
 * - Domibus running with proper PMode configuration
 * - Bridge backend running and connected to Domibus
 * - Mock EMREX provider running
 */

import { createClientAsync, BasicAuthSecurity } from 'soap';

const DOMIBUS_URL = process.env.DOMIBUS_URL || 'http://localhost:8080/domibus/services/wsplugin';
const DOMIBUS_USER = process.env.DOMIBUS_USER || 'admin';
const DOMIBUS_PASS = process.env.DOMIBUS_PASS || '123456';

// Sample OOTS QueryRequest XML
function createQueryRequestXml(options: {
  requestId: string;
  previewLocation?: string;
}): string {
  const previewLocationSlot = options.previewLocation
    ? `<rim:Slot name="PreviewLocation">
        <rim:SlotValue xsi:type="rim:StringValueType">
          <rim:Value>${options.previewLocation}</rim:Value>
        </rim:SlotValue>
      </rim:Slot>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<query:QueryRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0"
    xmlns:sdg="http://data.europa.eu/p4s"
    xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0"
    xmlns:query="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0"
    id="${options.requestId}">

    <rim:Slot name="SpecificationIdentifier">
        <rim:SlotValue xsi:type="rim:StringValueType">
            <rim:Value>oots-edm:v1.0</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="IssueDateTime">
        <rim:SlotValue xsi:type="rim:DateTimeValueType">
            <rim:Value>${new Date().toISOString()}</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="Procedure">
        <rim:SlotValue xsi:type="rim:InternationalStringValueType">
            <rim:Value>
                <rim:LocalizedString value="T3"/>
            </rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="PossibilityForPreview">
        <rim:SlotValue xsi:type="rim:BooleanValueType">
            <rim:Value>true</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    <rim:Slot name="ExplicitRequestGiven">
        <rim:SlotValue xsi:type="rim:BooleanValueType">
            <rim:Value>true</rim:Value>
        </rim:SlotValue>
    </rim:Slot>

    ${previewLocationSlot}

    <rim:Slot name="EvidenceRequester">
        <rim:SlotValue xsi:type="rim:CollectionValueType">
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
                    <sdg:Title lang="EN">Tertiary Education Diploma</sdg:Title>
                    <sdg:DistributedAs>
                        <sdg:Format>application/pdf</sdg:Format>
                    </sdg:DistributedAs>
                </sdg:DataServiceEvidenceType>
            </rim:SlotValue>
        </rim:Slot>
    </query:Query>
</query:QueryRequest>`;
}

interface DomibusClient {
  submitMessageAsync: (params: any) => Promise<any>;
  listPendingMessagesAsync: (params: any) => Promise<any>;
  retrieveMessageAsync: (params: any) => Promise<any>;
}

async function createDomibusClient(): Promise<DomibusClient> {
  const client = await createClientAsync(`${DOMIBUS_URL}?wsdl`);
  client.setSecurity(new BasicAuthSecurity(DOMIBUS_USER, DOMIBUS_PASS));
  return client as DomibusClient;
}

async function submitMessage(
  client: DomibusClient,
  conversationId: string,
  payload: string
): Promise<string> {
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await client.submitMessageAsync({
    bodyload: {
      value: Buffer.from(payload).toString('base64'),
      mimeType: 'application/x-ebrs+xml',
    },
    Messaging: {
      UserMessage: {
        MessageInfo: {
          MessageId: messageId,
        },
        PartyInfo: {
          From: {
            PartyId: {
              attributes: { type: 'urn:oasis:names:tc:ebcore:partyid-type:unregistered' },
              $value: 'red_gw',
            },
            Role: 'http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/initiator',
          },
          To: {
            PartyId: {
              attributes: { type: 'urn:oasis:names:tc:ebcore:partyid-type:unregistered' },
              $value: 'blue_gw',
            },
            Role: 'http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/responder',
          },
        },
        CollaborationInfo: {
          Service: {
            attributes: { type: 'urn:oots' },
            $value: 'urn:oots:services:evidence',
          },
          Action: 'ExecuteQueryRequest',
          ConversationId: conversationId,
        },
        MessageProperties: {
          Property: [
            {
              attributes: { name: 'originalSender', type: 'urn:oasis:names:tc:ebcore:partyid-type:unregistered' },
              $value: 'red_gw',
            },
            {
              attributes: { name: 'finalRecipient', type: 'urn:oasis:names:tc:ebcore:partyid-type:unregistered' },
              $value: 'blue_gw',
            },
          ],
        },
        PayloadInfo: {
          PartInfo: [
            {
              attributes: { href: 'cid:message' },
              PartProperties: {
                Property: [
                  {
                    attributes: { name: 'MimeType' },
                    $value: 'application/x-ebrs+xml',
                  },
                ],
              },
            },
          ],
        },
      },
    },
  });

  console.log(`[Test] Submitted message: ${messageId}`);
  return messageId;
}

async function waitForResponse(
  client: DomibusClient,
  conversationId: string,
  timeoutMs: number = 30000
): Promise<any> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const pendingResult = await client.listPendingMessagesAsync({});
      const messageIds = pendingResult[0]?.messageID || [];

      for (const msgId of Array.isArray(messageIds) ? messageIds : [messageIds]) {
        if (!msgId) continue;

        const retrieveResult = await client.retrieveMessageAsync({ messageID: msgId });
        const header = retrieveResult[2];

        if (header?.Messaging?.UserMessage?.CollaborationInfo?.ConversationId === conversationId) {
          console.log(`[Test] Found response for conversation: ${conversationId}`);
          return {
            messageId: msgId,
            action: header.Messaging.UserMessage.CollaborationInfo.Action,
            payload: retrieveResult[0],
          };
        }
      }
    } catch (err) {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return null;
}

// ============================================================================
// Test Scenarios
// ============================================================================

interface ScenarioResult {
  name: string;
  success: boolean;
  error?: string;
  response?: any;
}

async function runScenario1_InitialRequest(): Promise<ScenarioResult> {
  const name = 'Initial Evidence Request (PreviewRequired)';
  console.log(`\n--- Running: ${name} ---`);

  try {
    const client = await createDomibusClient();
    const requestId = `urn:uuid:${crypto.randomUUID()}`;
    const conversationId = `conv-${Date.now()}`;

    const queryXml = createQueryRequestXml({ requestId });
    await submitMessage(client, conversationId, queryXml);

    console.log('Waiting for Bridge to process and respond...');
    const response = await waitForResponse(client, conversationId, 30000);

    if (!response) {
      return { name, success: false, error: 'No response received within timeout' };
    }

    const isPreviewResponse =
      response.action === 'ExceptionResponse' ||
      (response.payload && JSON.stringify(response.payload).includes('PreviewRequired'));

    return {
      name,
      success: isPreviewResponse,
      response,
      error: isPreviewResponse ? undefined : 'Response does not indicate PreviewRequired',
    };
  } catch (error) {
    return { name, success: false, error: String(error) };
  }
}

async function runScenario2_FullFlowWithEvidence(): Promise<ScenarioResult> {
  const name = 'Full Evidence Exchange (with PreviewLocation)';
  console.log(`\n--- Running: ${name} ---`);

  try {
    const client = await createDomibusClient();
    const requestId = `urn:uuid:${crypto.randomUUID()}`;
    const conversationId = `conv-${Date.now()}`;
    const previewLocation = `http://localhost:3003/preview?sessionId=${crypto.randomUUID()}`;

    const queryXml = createQueryRequestXml({ requestId, previewLocation });
    await submitMessage(client, conversationId, queryXml);

    console.log('Waiting for full evidence flow...');
    const response = await waitForResponse(client, conversationId, 45000);

    if (!response) {
      return { name, success: false, error: 'No response received within timeout' };
    }

    return {
      name,
      success: response.action === 'ExecuteQueryResponse',
      response,
      error: response.action === 'ExecuteQueryResponse' ? undefined : `Unexpected action: ${response.action}`,
    };
  } catch (error) {
    return { name, success: false, error: String(error) };
  }
}

// ============================================================================
// Main
// ============================================================================

async function checkDomibusHealth(): Promise<boolean> {
  try {
    const client = await createDomibusClient();
    await client.listPendingMessagesAsync({});
    return true;
  } catch (err) {
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('OOTS Bridge E2E Test Scenarios (Real Domibus)');
  console.log('='.repeat(60));

  console.log('\nChecking Domibus connectivity...');
  const domibusOk = await checkDomibusHealth();
  if (!domibusOk) {
    console.error('ERROR: Cannot connect to Domibus at', DOMIBUS_URL);
    console.error('Make sure Domibus is running and accessible.');
    process.exit(1);
  }
  console.log('Domibus is healthy!\n');

  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith('--scenario='));
  const scenario = scenarioArg?.split('=')[1];

  const results: ScenarioResult[] = [];

  if (!scenario || scenario === 'all') {
    results.push(await runScenario1_InitialRequest());
    results.push(await runScenario2_FullFlowWithEvidence());
  } else if (scenario === '1') {
    results.push(await runScenario1_InitialRequest());
  } else if (scenario === '2') {
    results.push(await runScenario2_FullFlowWithEvidence());
  }

  console.log('\n' + '='.repeat(60));
  console.log('Results');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    console.log(`${status} ${result.name}`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
    if (result.success) passed++;
    else failed++;
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
