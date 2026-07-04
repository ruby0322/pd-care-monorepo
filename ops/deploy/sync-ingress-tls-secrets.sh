#!/usr/bin/env bash
set -euo pipefail

echo "This script is deprecated. TLS is now managed by cert-manager." >&2
echo "Use: kubectl apply -k k8s/cert-manager && kubectl get certificate -A" >&2
exit 1
