#!/bin/bash
# Trigger an OOTS evidence request through the Red Gateway
# This simulates an evidence requester sending a request to the evidence provider

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

RED_GATEWAY_URL="${RED_GATEWAY_URL:-http://localhost:8280}"
BLUE_GATEWAY_URL="${BLUE_GATEWAY_URL:-http://localhost:8180}"
DOMIBUS_USER="${DOMIBUS_USER:-admin}"
DOMIBUS_PASS="${DOMIBUS_PASS:-123456}"

# Generate unique message ID and conversation ID
MSG_UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
CONV_UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Create the payload content (base64 encoded)
PAYLOAD_CONTENT=$(cat <<'PAYLOADEOF'
<?xml version="1.0" encoding="UTF-8"?>
<QueryRequest xmlns="urn:oasis:names:tc:ebxml-regrep:xsd:query:4.0"
              xmlns:rs="urn:oasis:names:tc:ebxml-regrep:xsd:rs:4.0"
              xmlns:rim="urn:oasis:names:tc:ebxml-regrep:xsd:rim:4.0"
              xmlns:sdg="http://data.europa.eu/p4s"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              id="urn:uuid:test-request-001">
    <Query queryDefinition="urn:oasis:names:tc:ebxml-regrep:query:GetObjectById">
        <rim:Slot name="id">
            <rim:SlotValue xsi:type="rim:StringValueType">
                <rim:Value>test-evidence-id</rim:Value>
            </rim:SlotValue>
        </rim:Slot>
    </Query>
</QueryRequest>
PAYLOADEOF
)

# Base64 encode the payload
PAYLOAD_BASE64=$(echo -n "$PAYLOAD_CONTENT" | base64 -w 0)

# SOAP 1.2 envelope with ebMS3 Messaging header for WS Plugin
SOAP_MESSAGE=$(cat <<SOAPEOF
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:ns="http://eu.domibus.wsplugin/"
               xmlns:eb="http://docs.oasis-open.org/ebxml-msg/ebms/v3.0/ns/core/200704/">
    <soap:Header>
        <eb:Messaging>
            <eb:UserMessage>
                <eb:MessageInfo>
                    <eb:Timestamp>${TIMESTAMP}</eb:Timestamp>
                    <eb:MessageId>${MSG_UUID}@domibus.eu</eb:MessageId>
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
                    <eb:ConversationId>${CONV_UUID}</eb:ConversationId>
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
                <value>${PAYLOAD_BASE64}</value>
            </payload>
        </ns:submitRequest>
    </soap:Body>
</soap:Envelope>
SOAPEOF
)

echo "=========================================="
echo "OOTS E2E Request Trigger"
echo "=========================================="
echo ""
echo "Red Gateway (Requester): $RED_GATEWAY_URL"
echo "Blue Gateway (Provider): $BLUE_GATEWAY_URL"
echo ""

# Check if Red Gateway is ready
echo "Checking Red Gateway health..."
if ! curl -sf "$RED_GATEWAY_URL/domibus" > /dev/null 2>&1; then
    echo "ERROR: Red Gateway is not accessible at $RED_GATEWAY_URL"
    echo "Make sure the E2E stack is running: task e2e:start"
    exit 1
fi
echo "✓ Red Gateway is ready"

# Check if Blue Gateway is ready
echo "Checking Blue Gateway health..."
if ! curl -sf "$BLUE_GATEWAY_URL/domibus" > /dev/null 2>&1; then
    echo "ERROR: Blue Gateway is not accessible at $BLUE_GATEWAY_URL"
    echo "Make sure the E2E stack is running: task e2e:start"
    exit 1
fi
echo "✓ Blue Gateway is ready"

echo ""
echo "Sending test OOTS request from Red → Blue..."
echo ""

# Send the message through Red Gateway's WS Plugin
# Note: Using SOAP 1.2 content type (application/soap+xml)
RESPONSE=$(curl -s -X POST \
    "$RED_GATEWAY_URL/domibus/services/wsplugin" \
    -H "Content-Type: application/soap+xml; charset=utf-8" \
    -u "$DOMIBUS_USER:$DOMIBUS_PASS" \
    -d "$SOAP_MESSAGE" 2>&1)

# Check for SOAP fault in response
if echo "$RESPONSE" | grep -q "soap:Fault"; then
    echo "ERROR: SOAP Fault received"
    echo "$RESPONSE" | xmllint --format - 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

# Check for empty response
if [ -z "$RESPONSE" ]; then
    echo "ERROR: Empty response from server"
    exit 1
fi

echo "Response from Red Gateway:"
echo "$RESPONSE" | head -20
echo ""
echo "=========================================="
echo "Request sent successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Check Red Gateway messages: $RED_GATEWAY_URL/domibus (admin/123456)"
echo "2. Check Blue Gateway messages: $BLUE_GATEWAY_URL/domibus (admin/123456)"
echo "3. Check Bridge logs: docker logs oots-bridge"
echo "4. Check Kibana: http://localhost:5601"
