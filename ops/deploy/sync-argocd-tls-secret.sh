#!/usr/bin/env bash
set -euo pipefail

echo "This script is deprecated. Argo CD TLS is now managed by cert-manager." >&2
echo "Use: kubectl describe certificate argocd-pd-lu-im-ntu-edu-tw -n argocd" >&2
exit 1
