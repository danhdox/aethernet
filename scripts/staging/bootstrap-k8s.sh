#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${AETHERNET_K8S_NAMESPACE:-aethernet-staging}"
SECRETS_FILE="${1:-deploy/kubernetes/aethernet-secrets.example.yaml}"

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"

kubectl apply -n "$NAMESPACE" -f deploy/kubernetes/aethernet-configmap.yaml
kubectl apply -n "$NAMESPACE" -f "$SECRETS_FILE"
kubectl apply -n "$NAMESPACE" -f deploy/kubernetes/aethernet-deployment.yaml
kubectl apply -n "$NAMESPACE" -f deploy/kubernetes/aethernet-service.yaml

echo "Staging bootstrap applied in namespace: $NAMESPACE"
