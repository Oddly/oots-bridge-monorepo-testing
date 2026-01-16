#!/bin/bash
# Upload pModes to Domibus via REST API
# This script is called automatically during e2e:start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

BLUE_URL="${BLUE_GATEWAY_URL:-http://localhost:8180}"
RED_URL="${RED_GATEWAY_URL:-http://localhost:8280}"
DOMIBUS_USER="${DOMIBUS_USER:-admin}"
DOMIBUS_PASS="${DOMIBUS_PASS:-123456}"

BLUE_PMODE="$PROJECT_DIR/domibus/conf/pmode/pmode-configuration.xml"
RED_PMODE="$PROJECT_DIR/domibus/conf-red/pmode/pmode-configuration.xml"

upload_pmode() {
    local URL=$1
    local PMODE_FILE=$2
    local NAME=$3
    local COOKIE_JAR="/tmp/domibus-${NAME,,}-cookies.txt"

    echo "Uploading pMode to $NAME Gateway ($URL)..."

    # Clear old cookies
    rm -f "$COOKIE_JAR"

    # Get initial XSRF token
    curl -s -c "$COOKIE_JAR" "$URL/domibus/" > /dev/null
    local XSRF=$(grep XSRF "$COOKIE_JAR" 2>/dev/null | awk '{print $7}')

    # Login
    local LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -X POST "$URL/domibus/rest/security/authentication" \
        -H "Content-Type: application/json" \
        -H "X-XSRF-TOKEN: $XSRF" \
        -d "{\"username\":\"$DOMIBUS_USER\",\"password\":\"$DOMIBUS_PASS\"}")

    if echo "$LOGIN_RESP" | grep -q "Bad credentials"; then
        echo "  ERROR: Login failed - bad credentials"
        return 1
    fi

    # Get new XSRF after login
    XSRF=$(grep XSRF "$COOKIE_JAR" 2>/dev/null | awk '{print $7}')

    # Upload pMode
    local UPLOAD_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
        -X POST "$URL/domibus/rest/pmode" \
        -H "X-XSRF-TOKEN: $XSRF" \
        -F "file=@$PMODE_FILE" \
        -F "description=OOTS E2E $NAME PMode")

    local HTTP_CODE=$(echo "$UPLOAD_RESP" | tail -1)
    local BODY=$(echo "$UPLOAD_RESP" | head -n -1)

    if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "201" ]]; then
        echo "  SUCCESS: pMode uploaded to $NAME"
        return 0
    elif echo "$BODY" | grep -q "already"; then
        echo "  SKIP: pMode already exists on $NAME"
        return 0
    else
        echo "  ERROR: Upload failed (HTTP $HTTP_CODE)"
        echo "  Response: $BODY"
        return 1
    fi
}

echo "=========================================="
echo "OOTS PMode Upload"
echo "=========================================="
echo ""

# Upload to Blue Gateway
if ! upload_pmode "$BLUE_URL" "$BLUE_PMODE" "Blue"; then
    echo "Warning: Blue pMode upload failed"
fi

echo ""

# Upload to Red Gateway
if ! upload_pmode "$RED_URL" "$RED_PMODE" "Red"; then
    echo "Warning: Red pMode upload failed"
fi

echo ""
echo "=========================================="
echo "PMode upload complete"
echo "=========================================="
