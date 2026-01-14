#!/bin/bash
# Upload PMode configurations to both Domibus gateways
# Must be run after gateways are healthy
#
# NOTE: The REST API for PMode upload has security restrictions in the
# tanzari/domibus image that prevent automated upload. This script
# provides instructions for manual upload via the Admin Console.
#
# If REST API upload fails, PModes must be uploaded manually.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

BLUE_GATEWAY_URL="${BLUE_GATEWAY_URL:-http://localhost:8180}"
RED_GATEWAY_URL="${RED_GATEWAY_URL:-http://localhost:8280}"
DOMIBUS_USER="${DOMIBUS_USER:-admin}"
DOMIBUS_PASS="${DOMIBUS_PASS:-123456}"

BLUE_PMODE="$PROJECT_DIR/domibus/conf/pmode/pmode-configuration.xml"
RED_PMODE="$PROJECT_DIR/domibus/conf-red/pmode/pmode-configuration.xml"

echo "=========================================="
echo "OOTS PMode Configuration Upload"
echo "=========================================="
echo ""

upload_pmode() {
    local gateway_url="$1"
    local pmode_file="$2"
    local gateway_name="$3"

    echo "Uploading PMode to $gateway_name Gateway..."

    # Check gateway health
    if ! curl -sf "$gateway_url/domibus" > /dev/null 2>&1; then
        echo "ERROR: $gateway_name Gateway is not accessible at $gateway_url"
        return 1
    fi

    # Upload PMode via REST API
    RESPONSE=$(curl -sf -X POST \
        "$gateway_url/domibus/rest/pmode" \
        -H "Content-Type: multipart/form-data" \
        -u "$DOMIBUS_USER:$DOMIBUS_PASS" \
        -F "file=@$pmode_file" \
        -F "description=OOTS E2E Testing PMode" 2>&1) || {
        # Try alternate API endpoint for different Domibus versions
        RESPONSE=$(curl -sf -X PUT \
            "$gateway_url/domibus/rest/pmode" \
            -H "Content-Type: application/xml" \
            -u "$DOMIBUS_USER:$DOMIBUS_PASS" \
            --data-binary "@$pmode_file" 2>&1) || {
            echo "WARNING: Could not upload PMode via REST API"
            echo "Response: $RESPONSE"
            echo ""
            echo "Please upload manually via Admin Console:"
            echo "  1. Go to $gateway_url/domibus"
            echo "  2. Login with $DOMIBUS_USER / $DOMIBUS_PASS"
            echo "  3. Navigate to PMode > Current"
            echo "  4. Upload: $pmode_file"
            return 1
        }
    }

    echo "✓ PMode uploaded to $gateway_name Gateway"
    return 0
}

# Upload to Blue Gateway
if upload_pmode "$BLUE_GATEWAY_URL" "$BLUE_PMODE" "Blue"; then
    echo ""
fi

# Upload to Red Gateway
if upload_pmode "$RED_GATEWAY_URL" "$RED_PMODE" "Red"; then
    echo ""
fi

echo "=========================================="
echo "PMode upload complete"
echo "=========================================="
echo ""
echo "Verify PModes in Admin Consoles:"
echo "  Blue: $BLUE_GATEWAY_URL/domibus"
echo "  Red:  $RED_GATEWAY_URL/domibus"
