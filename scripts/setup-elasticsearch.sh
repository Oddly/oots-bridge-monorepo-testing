#!/bin/bash
# Setup Elasticsearch with OOTS ingest pipeline

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."

ES_URL="${ES_URL:-http://localhost:9200}"
PIPELINE_FILE="${PIPELINE_FILE:-$PROJECT_DIR/../oots-logging-states/state3-otel/pipeline/ingest-pipeline.json}"

echo "=========================================="
echo "Elasticsearch OOTS Pipeline Setup"
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

# Check if pipeline file exists
if [ ! -f "$PIPELINE_FILE" ]; then
    echo "WARNING: Pipeline file not found at $PIPELINE_FILE"
    echo "Creating a basic OOTS ingest pipeline..."

    # Create basic pipeline inline
    curl -sf -X PUT "$ES_URL/_ingest/pipeline/oots-state3-ecs" \
        -H "Content-Type: application/json" \
        -d '{
        "description": "OOTS State 3 ECS Pipeline",
        "processors": [
            {
                "script": {
                    "description": "Flatten log.oots to oots",
                    "lang": "painless",
                    "source": "if (ctx.log != null && ctx.log.oots != null && ctx.oots == null) { ctx.oots = ctx.log.oots; }"
                }
            },
            {
                "rename": {
                    "field": "msg",
                    "target_field": "message",
                    "ignore_missing": true
                }
            },
            {
                "date": {
                    "field": "time",
                    "target_field": "@timestamp",
                    "formats": ["ISO8601"],
                    "ignore_failure": true
                }
            }
        ]
    }' || {
        echo "ERROR: Failed to create pipeline"
        exit 1
    }
else
    echo "Installing pipeline from: $PIPELINE_FILE"
    curl -sf -X PUT "$ES_URL/_ingest/pipeline/oots-state3-ecs" \
        -H "Content-Type: application/json" \
        -d "@$PIPELINE_FILE" || {
        echo "ERROR: Failed to install pipeline"
        exit 1
    }
fi

echo "✓ OOTS ingest pipeline installed"
echo ""

# Create index template
echo "Creating index template..."
curl -sf -X PUT "$ES_URL/_index_template/oots-logs" \
    -H "Content-Type: application/json" \
    -d '{
    "index_patterns": ["oots-logs-*"],
    "template": {
        "settings": {
            "index": {
                "number_of_shards": 1,
                "number_of_replicas": 0,
                "default_pipeline": "oots-state3-ecs"
            }
        },
        "mappings": {
            "dynamic": true,
            "properties": {
                "@timestamp": { "type": "date" },
                "message": { "type": "text" },
                "level": { "type": "keyword" },
                "oots": {
                    "type": "object",
                    "properties": {
                        "scenario": { "type": "keyword" },
                        "result": { "type": "keyword" },
                        "reason": { "type": "keyword" },
                        "error": { "type": "keyword" },
                        "step": { "type": "keyword" },
                        "conversationId": { "type": "keyword" },
                        "responseId": { "type": "keyword" }
                    }
                },
                "messaging": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "keyword" }
                            }
                        }
                    }
                },
                "transaction": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "keyword" }
                    }
                }
            }
        }
    }
}' || {
    echo "WARNING: Failed to create index template"
}

echo "✓ Index template created"
echo ""
echo "=========================================="
echo "Elasticsearch setup complete"
echo "=========================================="
echo ""
echo "Kibana: http://localhost:5601"
echo "Index pattern: oots-logs-*"
