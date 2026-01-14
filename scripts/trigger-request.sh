#!/bin/bash
# Trigger a proper OOTS evidence request through the Red Gateway
# This sends a valid OOTS QueryRequest that passes XSD and Schematron validation
#
# The message flow:
#   Red Gateway -> Blue Gateway (AS4) -> Bridge -> PREVIEW_REQUIRED Response
#
# Prerequisites:
#   - E2E stack running (task e2e:start)
#   - PModes uploaded (automatically done by e2e:start)
#   - testdata/sample-query-request.xml exists

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

RED_GATEWAY_URL="${RED_GATEWAY_URL:-http://localhost:8280}"
DOMIBUS_USER="${DOMIBUS_USER:-admin}"
DOMIBUS_PASS="${DOMIBUS_PASS:-123456}"

# Generate unique IDs
QUERY_UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
MSG_UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
CONV_UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Read the sample QueryRequest template and replace placeholders
QUERY_REQUEST_TEMPLATE="$PROJECT_DIR/testdata/sample-query-request.xml"

if [ ! -f "$QUERY_REQUEST_TEMPLATE" ]; then
    echo "ERROR: Sample QueryRequest not found: $QUERY_REQUEST_TEMPLATE"
    echo ""
    echo "The sample-query-request.xml file contains a valid OOTS QueryRequest that"
    echo "passes both XSD and Schematron validation."
    exit 1
fi

# Create the payload by replacing placeholders
PAYLOAD_CONTENT=$(cat "$QUERY_REQUEST_TEMPLATE" \
    | sed "s/QUERY_ID_PLACEHOLDER/urn:uuid:$QUERY_UUID/" \
    | sed "s/TIMESTAMP_PLACEHOLDER/$TIMESTAMP/")

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
echo "OOTS Full Chain Request"
echo "=========================================="
echo ""
echo "Request Details:"
echo "  Query ID: urn:uuid:$QUERY_UUID"
echo "  Message ID: $MSG_UUID@domibus.eu"
echo "  Conversation ID: $CONV_UUID"
echo "  Evidence Provider: EMREX - DUO NL (00000001800866472000)"
echo "  Subject: Jonas Smith, DOB 1999-03-01"
echo ""

# Check gateways
echo "Checking gateways..."
if ! curl -sf "$RED_GATEWAY_URL/domibus" > /dev/null 2>&1; then
    echo "ERROR: Red Gateway not accessible at $RED_GATEWAY_URL"
    echo "Make sure the E2E stack is running: task e2e:start"
    exit 1
fi
echo "  Red Gateway: OK"

# Send the message
echo ""
echo "Sending OOTS QueryRequest: Red Gateway -> Blue Gateway -> Bridge"
echo ""

RESPONSE=$(curl -s -X POST \
    "$RED_GATEWAY_URL/domibus/services/wsplugin" \
    -H "Content-Type: application/soap+xml; charset=utf-8" \
    -u "$DOMIBUS_USER:$DOMIBUS_PASS" \
    -d "$SOAP_MESSAGE" 2>&1)

# Check response
if echo "$RESPONSE" | grep -q "soap:Fault"; then
    echo "ERROR: SOAP Fault received"
    echo "$RESPONSE" | xmllint --format - 2>/dev/null || echo "$RESPONSE"
    exit 1
fi

if [ -z "$RESPONSE" ]; then
    echo "ERROR: Empty response"
    exit 1
fi

# Extract message ID from response
RESP_MSG_ID=$(echo "$RESPONSE" | grep -oP '<messageID>[^<]+</messageID>' | sed 's/<[^>]*>//g')

echo "Message accepted by Red Gateway!"
echo "  Response Message ID: $RESP_MSG_ID"
echo ""
echo "=========================================="
echo ""
echo "The message will now flow:"
echo "  1. Red Gateway sends to Blue Gateway (AS4)"
echo "  2. Blue Gateway receives and stores message"
echo "  3. Bridge polls Blue Gateway for pending messages"
echo "  4. Bridge processes QueryRequest"
echo "  5. Bridge sends response (PREVIEW_REQUIRED or evidence)"
echo ""
echo "Watch the logs:"
echo "  docker logs -f oots-bridge"
echo ""
echo "Check message status:"
echo "  Red Gateway:  http://localhost:8280/domibus"
echo "  Blue Gateway: http://localhost:8180/domibus"
echo ""
