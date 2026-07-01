#!/usr/bin/env bash
# Rotate PD Care K8s overlay secrets after credential leakage in git history.
# Writes gitignored k8s/overlays/{dev,prod}/secret.yaml and applies to the cluster.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

rand_token() {
  local prefix="$1"
  local nbytes="${2:-24}"
  printf '%s_%s' "$prefix" "$(openssl rand -base64 "$nbytes" | tr -d '/+=' | head -c 32)"
}

write_secret_yaml() {
  local env="$1"
  local pg_pass="$2"
  local s3_access="$3"
  local s3_secret="$4"
  local image_token="$5"
  local auth_token="$6"
  local out="k8s/overlays/${env}/secret.yaml"

  cat >"$out" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: pd-care-secrets
type: Opaque
stringData:
  # Rotated $(date -u +%Y-%m-%dT%H:%MZ) after git history exposure — do not commit.
  PDCARE_POSTGRES_PASSWORD: "${pg_pass}"
  DATABASE_URL: "postgresql+psycopg://postgres:${pg_pass}@postgres:5432/pd_care"
  S3_ACCESS_KEY: "${s3_access}"
  S3_SECRET_KEY: "${s3_secret}"
  IMAGE_ACCESS_TOKEN_SECRET: "${image_token}"
  AUTH_TOKEN_SECRET: "${auth_token}"
  HF_TOKEN: ""
EOF
  chmod 600 "$out"
  echo "Wrote ${out}"
}

rotate_postgres_password() {
  local namespace="$1"
  local new_password="$2"
  local pod
  pod="$(kubectl get pods -n "$namespace" -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$pod" ]]; then
    echo "No postgres pod in ${namespace}; skip ALTER USER (fresh deploy will use new secret)."
    return 0
  fi
  kubectl exec -n "$namespace" "$pod" -- \
    psql -U postgres -d pd_care -v ON_ERROR_STOP=1 \
    -c "ALTER USER postgres WITH PASSWORD '${new_password}';"
  echo "Postgres password updated in ${namespace}/${pod}"
}

apply_namespace() {
  local env="$1"
  local namespace="pd-care-${env}"
  local secret_file="k8s/overlays/${env}/secret.yaml"

  if ! kubectl get namespace "$namespace" >/dev/null 2>&1; then
    echo "Namespace ${namespace} not found; apply overlay after secrets are created."
    kubectl apply -f "$secret_file"
    return 0
  fi

  kubectl apply -f "$secret_file" -n "$namespace"

  local pg_pass
  pg_pass="$(grep 'PDCARE_POSTGRES_PASSWORD:' "$secret_file" | sed -E 's/.*: "(.*)"/\1/')"
  rotate_postgres_password "$namespace" "$pg_pass"

  if kubectl get deployment backend -n "$namespace" >/dev/null 2>&1; then
    kubectl rollout restart deployment/backend -n "$namespace"
    kubectl rollout status deployment/backend -n "$namespace" --timeout=300s
  fi
}

main() {
  echo "Generating rotated credentials for dev and prod overlays..."

  dev_pg="$(rand_token dev_PG)"
  dev_s3_access="$(rand_token devS3Access)"
  dev_s3_secret="$(rand_token devS3Secret)"
  dev_image="$(rand_token devImageToken)"
  dev_auth="$(rand_token devAuthToken)"

  prod_pg="$(rand_token prod_PG)"
  prod_s3_access="$(rand_token prodS3Access)"
  prod_s3_secret="$(rand_token prodS3Secret)"
  prod_image="$(rand_token prodImageToken)"
  prod_auth="$(rand_token prodAuthToken)"

  write_secret_yaml dev "$dev_pg" "$dev_s3_access" "$dev_s3_secret" "$dev_image" "$dev_auth"
  write_secret_yaml prod "$prod_pg" "$prod_s3_access" "$prod_s3_secret" "$prod_image" "$prod_auth"

  if ! kubectl cluster-info >/dev/null 2>&1; then
    echo "Kubernetes API unreachable. Secret files written; start the cluster and re-run:"
    echo "  $0 --apply-only"
    exit 0
  fi

  apply_namespace dev
  apply_namespace prod
  echo "Rotation complete. Existing auth/image tokens are invalidated; users must re-login."
}

if [[ "${1:-}" == "--apply-only" ]]; then
  apply_namespace dev
  apply_namespace prod
  echo "Applied rotated secrets to cluster."
else
  main
fi
