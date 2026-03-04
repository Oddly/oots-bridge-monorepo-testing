#!/bin/bash
# Request Summary - Shows one line per OOTS request with status and error message
#
# Usage: ./scripts/request-summary.sh [limit]
#   limit: Number of recent requests to show (default: 50)

LIMIT=${1:-50}
ES_URL=${ES_URL:-http://localhost:9200}

echo ""
echo "OOTS Request Summary (last $LIMIT requests)"
echo "============================================="
echo ""

# Query aggregates by conversation ID and checks:
# - oots.response.result for overall outcome (success/error/partial)
# - exception.message for error details
# - oots.error.code for OOTS error codes
curl -s "$ES_URL/oots-*/_search" -H "Content-Type: application/json" -d "{
  \"size\": 0,
  \"aggs\": {
    \"by_conversation\": {
      \"terms\": { \"field\": \"oots.conversation.id\", \"size\": $LIMIT },
      \"aggs\": {
        \"response_result\": {
          \"terms\": { \"field\": \"oots.response.result\", \"size\": 5 }
        },
        \"step_failures\": {
          \"filter\": { \"term\": { \"event.outcome\": \"failure\" } }
        },
        \"errors\": {
          \"terms\": { \"field\": \"exception.message.keyword\", \"size\": 1 }
        },
        \"error_codes\": {
          \"terms\": { \"field\": \"oots.error.code.keyword\", \"size\": 1 }
        },
        \"started\": { \"min\": { \"field\": \"@timestamp\" } },
        \"ended\": { \"max\": { \"field\": \"@timestamp\" } }
      }
    }
  }
}" | jq -r '
.aggregations.by_conversation.buckets | sort_by(.started.value) | reverse | .[] |
{
  timestamp: .started.value_as_string,
  response_result: (.response_result.buckets[0].key // "unknown"),
  step_failures: .step_failures.doc_count,
  conversation: .key,
  duration_ms: ((.ended.value - .started.value) | floor),
  events: .doc_count,
  error: (.errors.buckets[0].key // null),
  error_code: (.error_codes.buckets[0].key // null)
} |
"\(.timestamp) | \(
  if .response_result == "success" then "✅ SUCCESS"
  elif .response_result == "error" then "❌ ERROR  "
  elif .response_result == "partial" then "⚠️  PARTIAL"
  else "❓ \(.response_result)"
  end
) | \(.events) events | \(.duration_ms)ms | \(.conversation)\(
  if .error then " | \(.error)"
  elif .error_code then " | Code: \(.error_code)"
  else ""
  end
)"
'

echo ""
echo "Legend: ✅ = Evidence delivered successfully"
echo "        ❌ = Error response sent (check error message)"
echo "        ⚠️  = Partial response (some evidence delivered)"
echo ""
