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
echo "=========================================="
echo "Elasticsearch setup complete"
echo "=========================================="
echo ""
echo "Kibana: http://localhost:5601"
echo "Index pattern: oots-logs-*"
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
