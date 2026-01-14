#!/bin/bash
# Deploy OOTS E2E Testing Stack to Kubernetes
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"
NAMESPACE="oots-e2e-test"

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  deploy    - Deploy all resources to Kubernetes"
    echo "  delete    - Delete all resources from Kubernetes"
    echo "  status    - Show deployment status"
    echo "  logs      - Show logs from all pods"
    echo "  forward   - Start port-forwarding for local access"
    echo "  wait      - Wait for all pods to be ready"
    echo ""
}

deploy() {
    echo "=== Deploying OOTS E2E Testing Stack to Kubernetes ==="

    # Apply with kustomize
    kubectl apply -k "$K8S_DIR"

    echo ""
    echo "Deployment started. Run '$0 wait' to wait for pods to be ready."
    echo "Or run '$0 status' to check current status."
}

delete() {
    echo "=== Deleting OOTS E2E Testing Stack ==="

    kubectl delete -k "$K8S_DIR" --ignore-not-found

    # Clean up PVCs
    echo "Cleaning up persistent volume claims..."
    kubectl delete pvc -n "$NAMESPACE" --all --ignore-not-found 2>/dev/null || true

    # Delete namespace
    kubectl delete namespace "$NAMESPACE" --ignore-not-found 2>/dev/null || true

    echo "Cleanup complete."
}

status() {
    echo "=== OOTS E2E Test Stack Status ==="
    echo ""

    echo "Pods:"
    kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null || echo "Namespace not found"

    echo ""
    echo "Services:"
    kubectl get svc -n "$NAMESPACE" 2>/dev/null || echo "Namespace not found"

    echo ""
    echo "PVCs:"
    kubectl get pvc -n "$NAMESPACE" 2>/dev/null || echo "Namespace not found"
}

logs() {
    local pod_name="${1:-}"

    if [ -n "$pod_name" ]; then
        kubectl logs -n "$NAMESPACE" -f "$pod_name"
    else
        echo "=== Logs from all pods ==="
        for pod in $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
            echo "--- $pod ---"
            kubectl logs -n "$NAMESPACE" "$pod" --tail=20 2>/dev/null || echo "  (no logs)"
            echo ""
        done
    fi
}

wait_ready() {
    echo "=== Waiting for pods to be ready ==="

    # Wait for MySQL
    echo "Waiting for MySQL..."
    kubectl wait --for=condition=ready pod -l app=mysql -n "$NAMESPACE" --timeout=300s 2>/dev/null || {
        echo "MySQL not ready yet, checking status..."
        kubectl get pods -n "$NAMESPACE" -l app=mysql
    }

    # Wait for ActiveMQ
    echo "Waiting for ActiveMQ..."
    kubectl wait --for=condition=ready pod -l app=activemq -n "$NAMESPACE" --timeout=300s 2>/dev/null || {
        echo "ActiveMQ not ready yet, checking status..."
        kubectl get pods -n "$NAMESPACE" -l app=activemq
    }

    # Wait for Elasticsearch
    echo "Waiting for Elasticsearch..."
    kubectl wait --for=condition=ready pod -l app=elasticsearch -n "$NAMESPACE" --timeout=300s 2>/dev/null || {
        echo "Elasticsearch not ready yet, checking status..."
        kubectl get pods -n "$NAMESPACE" -l app=elasticsearch
    }

    # Wait for Domibus (takes longest)
    echo "Waiting for Domibus (this may take 2-3 minutes)..."
    kubectl wait --for=condition=ready pod -l app=domibus -n "$NAMESPACE" --timeout=600s 2>/dev/null || {
        echo "Domibus not ready yet, checking status..."
        kubectl get pods -n "$NAMESPACE" -l app=domibus
    }

    # Wait for other services
    echo "Waiting for other services..."
    kubectl wait --for=condition=ready pod -l app=mock-emrex -n "$NAMESPACE" --timeout=120s 2>/dev/null || true
    kubectl wait --for=condition=ready pod -l app=kibana -n "$NAMESPACE" --timeout=300s 2>/dev/null || true
    kubectl wait --for=condition=ready pod -l app=logstash -n "$NAMESPACE" --timeout=120s 2>/dev/null || true

    echo ""
    echo "=== Final Status ==="
    status
}

forward() {
    echo "=== Starting port-forwarding ==="
    echo ""
    echo "This will start port-forwarding for:"
    echo "  - Domibus Admin:     http://localhost:8080/domibus (admin/123456)"
    echo "  - Elasticsearch:     http://localhost:9200"
    echo "  - Kibana:           http://localhost:5601"
    echo "  - ActiveMQ Console: http://localhost:8161 (admin/admin)"
    echo "  - Mock EMREX:       http://localhost:9081"
    echo ""
    echo "Press Ctrl+C to stop all port-forwarding"
    echo ""

    # Start port-forwards in background
    kubectl port-forward -n "$NAMESPACE" svc/domibus 8080:8080 &
    kubectl port-forward -n "$NAMESPACE" svc/elasticsearch 9200:9200 &
    kubectl port-forward -n "$NAMESPACE" svc/kibana 5601:5601 &
    kubectl port-forward -n "$NAMESPACE" svc/activemq 8161:8161 &
    kubectl port-forward -n "$NAMESPACE" svc/mock-emrex 9081:9081 &

    # Wait for all background jobs
    wait
}

# Main
case "${1:-}" in
    deploy)
        deploy
        ;;
    delete)
        delete
        ;;
    status)
        status
        ;;
    logs)
        logs "${2:-}"
        ;;
    wait)
        wait_ready
        ;;
    forward)
        forward
        ;;
    *)
        usage
        exit 1
        ;;
esac
