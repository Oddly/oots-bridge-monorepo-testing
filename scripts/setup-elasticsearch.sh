#!/bin/bash
# Setup Elasticsearch index template for OOTS structured logging
#
# This script creates the index template with proper field mappings
# for OOTS logs using OpenTelemetry/ECS conventions. Run this after
# Elasticsearch is healthy.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

ES_URL="${ES_URL:-http://localhost:9200}"
KIBANA_URL="${KIBANA_URL:-http://localhost:5601}"
TEMPLATE_FILE="$PROJECT_DIR/elasticsearch/oots-logs-template.json"

echo "=========================================="
echo "Elasticsearch OOTS Logging Setup"
echo "=========================================="
echo ""

# Wait for Elasticsearch
echo "Waiting for Elasticsearch..."
for i in {1..30}; do
    if curl -sf "$ES_URL/_cluster/health" > /dev/null 2>&1; then
        echo "✓ Elasticsearch is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: Elasticsearch not ready after 30 attempts"
        exit 1
    fi
    echo "  Waiting... ($i/30)"
    sleep 2
done

echo ""

# Create index template from file if it exists, otherwise use inline template
if [ -f "$TEMPLATE_FILE" ]; then
    echo "Installing index template from: $TEMPLATE_FILE"
    curl -sf -X PUT "$ES_URL/_index_template/oots-logs" \
        -H "Content-Type: application/json" \
        -d "@$TEMPLATE_FILE" || {
        echo "ERROR: Failed to create index template"
        exit 1
    }
else
    echo "Template file not found, creating index template inline..."
    curl -sf -X PUT "$ES_URL/_index_template/oots-logs" \
        -H "Content-Type: application/json" \
        -d '{
    "index_patterns": ["oots-logs-*"],
    "template": {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "index.mapping.total_fields.limit": 5000
        },
        "mappings": {
            "dynamic": true,
            "properties": {
                "@timestamp": { "type": "date" },
                "log.level": { "type": "keyword" },
                "log.logger": { "type": "keyword" },
                "log.source": { "type": "keyword" },
                "trace.id": { "type": "keyword" },
                "event.action": { "type": "keyword" },
                "event.outcome": { "type": "keyword" },
                "event.created": { "type": "date" },
                "event.category": { "type": "keyword" },
                "event.type": { "type": "keyword" },
                "messaging.system": { "type": "keyword" },
                "messaging.operation": { "type": "keyword" },
                "messaging.message.body.size": { "type": "integer" },
                "messaging.message.payload_type": { "type": "keyword" },
                "oots": {
                    "type": "object",
                    "properties": {
                        "edm.version": { "type": "keyword" },
                        "message.type": { "type": "keyword" },
                        "message.id": { "type": "keyword" },
                        "conversation.id": { "type": "keyword" },
                        "request.id": { "type": "keyword" },
                        "request.time": { "type": "date" },
                        "response.id": { "type": "keyword" },
                        "response.result": { "type": "keyword" },
                        "response.status": { "type": "keyword" },
                        "procedure": { "type": "keyword" },
                        "preview.required": { "type": "boolean" },
                        "preview.explicit_request": { "type": "boolean" },
                        "requester.name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
                        "requester.country": { "type": "keyword" },
                        "requester.id.scheme": { "type": "keyword" },
                        "requester.id.value": { "type": "keyword" },
                        "provider.name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
                        "provider.id.scheme": { "type": "keyword" },
                        "provider.id.value": { "type": "keyword" },
                        "evidence.type.id": { "type": "keyword" },
                        "evidence.type.title": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
                        "evidence.type.classification": { "type": "keyword" },
                        "evidence.format": { "type": "keyword" },
                        "requirements": { "type": "text" },
                        "transaction.phase": { "type": "keyword" },
                        "natural_person": {
                            "type": "object",
                            "properties": {
                                "level_of_assurance": { "type": "keyword" },
                                "family_name": { "type": "keyword" },
                                "given_name": { "type": "keyword" },
                                "date_of_birth": { "type": "date", "format": "yyyy-MM-dd" }
                            }
                        },
                        "non_repudiation": {
                            "type": "object",
                            "enabled": false
                        }
                    }
                }
            }
        }
    },
    "priority": 200
}' || {
        echo "ERROR: Failed to create index template"
        exit 1
    }
fi

echo "✓ Index template 'oots-logs' created"
echo ""

# Create ingest pipeline to extract test.path from conversation ID
# Conversation IDs from tests are formatted as: path-N-uuid
echo "Creating ingest pipeline for test path extraction..."
curl -sf -X PUT "$ES_URL/_ingest/pipeline/oots-test-path" \
    -H "Content-Type: application/json" \
    -d '{
    "description": "Extract test path number from conversation ID (path-N-uuid format)",
    "processors": [
        {
            "grok": {
                "field": "oots.conversation.id",
                "patterns": ["path-(?<test_path_str>\\d+)-.*"],
                "ignore_missing": true,
                "ignore_failure": true
            }
        },
        {
            "convert": {
                "field": "test_path_str",
                "target_field": "test.path",
                "type": "integer",
                "ignore_missing": true,
                "ignore_failure": true
            }
        },
        {
            "remove": {
                "field": "test_path_str",
                "ignore_missing": true
            }
        }
    ]
}' && echo "✓ Ingest pipeline 'oots-test-path' created" || echo "⚠ Failed to create ingest pipeline (non-fatal)"

echo ""

# Create Kibana data view for oots-logs-*
echo "Creating Kibana data view..."

# Wait for Kibana to be ready
echo "Waiting for Kibana..."
for i in {1..30}; do
    if curl -sf "$KIBANA_URL/api/status" > /dev/null 2>&1; then
        echo "✓ Kibana is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠ Kibana not ready after 30 attempts, skipping data view creation"
        SKIP_KIBANA=true
        break
    fi
    echo "  Waiting... ($i/30)"
    sleep 2
done

if [ "$SKIP_KIBANA" != "true" ]; then
    # Check if data view already exists
    EXISTING=$(curl -sf "$KIBANA_URL/api/data_views/data_view/oots-logs" \
        -H "kbn-xsrf: true" 2>/dev/null || echo "")

    if [ -n "$EXISTING" ] && echo "$EXISTING" | grep -q '"id":"oots-logs"'; then
        echo "✓ Data view 'oots-logs' already exists"
    else
        # Create the data view
        curl -sf -X POST "$KIBANA_URL/api/data_views/data_view" \
            -H "kbn-xsrf: true" \
            -H "Content-Type: application/json" \
            -d '{
            "data_view": {
                "id": "oots-logs",
                "title": "oots-logs-*",
                "name": "OOTS Logs",
                "timeFieldName": "@timestamp"
            }
        }' > /dev/null && echo "✓ Data view 'oots-logs' created" || echo "⚠ Failed to create data view (non-fatal)"
    fi

    # Import E2E test dashboard
    DASHBOARD_FILE="$PROJECT_DIR/kibana/oots-dashboard.ndjson"
    if [ -f "$DASHBOARD_FILE" ]; then
        echo "Importing E2E test dashboard..."
        IMPORT_RESULT=$(curl -sf -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
            -H "kbn-xsrf: true" \
            --form file=@"$DASHBOARD_FILE" 2>&1)

        if echo "$IMPORT_RESULT" | grep -q '"success":true'; then
            echo "✓ Dashboard 'OOTS E2E Test Dashboard' imported"
        else
            echo "⚠ E2E dashboard import had issues (non-fatal)"
        fi
    fi

    # Import production-style dashboards (Main, Trace Details, Error Details)
    PROD_DASHBOARD_FILE="$PROJECT_DIR/kibana/oots-production-dashboards.ndjson"
    if [ -f "$PROD_DASHBOARD_FILE" ]; then
        echo "Importing production dashboards..."
        IMPORT_RESULT=$(curl -sf -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
            -H "kbn-xsrf: true" \
            --form file=@"$PROD_DASHBOARD_FILE" 2>&1)

        SUCCESS_COUNT=$(echo "$IMPORT_RESULT" | grep -o '"successCount":[0-9]*' | grep -o '[0-9]*')
        if [ -n "$SUCCESS_COUNT" ] && [ "$SUCCESS_COUNT" -gt 0 ]; then
            echo "✓ Production dashboards imported ($SUCCESS_COUNT objects)"
        else
            echo "⚠ Production dashboard import had issues (non-fatal)"
        fi
    fi

    # Import sequence timeline dashboard (Vega visualization)
    SEQUENCE_DASHBOARD_FILE="$PROJECT_DIR/kibana/oots-sequence-dashboard.ndjson"
    if [ -f "$SEQUENCE_DASHBOARD_FILE" ]; then
        echo "Importing sequence timeline dashboard..."
        IMPORT_RESULT=$(curl -sf -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
            -H "kbn-xsrf: true" \
            --form file=@"$SEQUENCE_DASHBOARD_FILE" 2>&1)

        if echo "$IMPORT_RESULT" | grep -q '"success":true'; then
            echo "✓ Sequence timeline dashboard imported"
        else
            echo "⚠ Sequence dashboard import had issues (non-fatal)"
        fi
    fi
fi

echo ""
echo "=========================================="
echo "Setup complete"
echo "=========================================="
echo ""
echo "Kibana: http://localhost:5601"
echo "Data view: oots-logs-*"
echo ""
echo "Dashboards:"
echo "  - E2E Test:      http://localhost:5601/app/dashboards#/view/oots-e2e-dashboard"
echo "  - Sequence:      http://localhost:5601/app/dashboards#/view/oots-sequence-dashboard"
echo "  - Main:          http://localhost:5601/app/dashboards#/view/60d6d64a-f484-42e6-a9f6-c24862a672a8"
echo "  - Trace Details: http://localhost:5601/app/dashboards#/view/9f41ed5c-7f08-481b-b56e-fff441ea72ad"
echo "  - Error Details: http://localhost:5601/app/dashboards#/view/a473fc17-090e-44b2-9bff-134e13eb64f0"
echo ""
echo "Available OOTS fields:"
echo "  - oots.message.type (QueryRequest/QueryResponse)"
echo "  - oots.conversation.id"
echo "  - oots.request.id"
echo "  - oots.response.result"
echo "  - oots.requester.name, oots.requester.country"
echo "  - oots.provider.name, oots.provider.id.value"
echo "  - event.action, event.outcome"
echo "  - trace.id (for distributed tracing)"
