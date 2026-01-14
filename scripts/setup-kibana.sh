#!/bin/bash
# Setup Kibana with OOTS dashboard and saved objects
#
# This script imports the data view, saved search, and dashboard
# for monitoring OOTS Bridge logs. Run after Kibana is healthy.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

KIBANA_URL="${KIBANA_URL:-http://localhost:5601}"
DASHBOARD_FILE="$PROJECT_DIR/kibana/oots-dashboard.ndjson"

echo "=========================================="
echo "Kibana OOTS Dashboard Setup"
echo "=========================================="
echo ""

# Wait for Kibana
echo "Waiting for Kibana..."
for i in {1..60}; do
    if curl -sf "$KIBANA_URL/api/status" > /dev/null 2>&1; then
        echo "✓ Kibana is ready"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "ERROR: Kibana not ready after 60 attempts"
        exit 1
    fi
    echo "  Waiting... ($i/60)"
    sleep 2
done

echo ""

# Import dashboard and saved objects
if [ -f "$DASHBOARD_FILE" ]; then
    echo "Importing OOTS dashboard from: $DASHBOARD_FILE"

    RESPONSE=$(curl -sf -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
        -H "kbn-xsrf: true" \
        -F file=@"$DASHBOARD_FILE" 2>&1) || {
        echo "ERROR: Failed to import dashboard"
        echo "$RESPONSE"
        exit 1
    }

    SUCCESS_COUNT=$(echo "$RESPONSE" | grep -o '"successCount":[0-9]*' | cut -d: -f2)
    echo "✓ Imported $SUCCESS_COUNT objects"
else
    echo "WARNING: Dashboard file not found: $DASHBOARD_FILE"
    echo "Dashboard will need to be created manually"
fi

echo ""
echo "=========================================="
echo "Kibana setup complete"
echo "=========================================="
echo ""
echo "Dashboard URL: $KIBANA_URL/app/dashboards#/view/oots-bridge-monitor"
echo ""
echo "Available views:"
echo "  - OOTS Bridge Monitor (dashboard)"
echo "  - OOTS Logs (saved search)"
echo ""
echo "Key fields for filtering:"
echo "  - trace.id (transaction identifier)"
echo "  - oots.conversation.id (Domibus conversation)"
echo "  - oots.message.id (Domibus message)"
echo "  - event.action (evidence_request_received, evidence_response_sent)"
echo "  - oots.response.result (preview_requested, evidence_delivered, error)"
echo "  - log.logger (APP, OOTS, EXT)"
