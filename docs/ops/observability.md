# Observability

PD Care observability stack:

- Prometheus
- Loki + Promtail
- Grafana

## Start

```bash
npm run docker:up:obs
```

## Stop

```bash
npm run docker:down:obs
```

## Access

- Grafana direct (host port mapped): `http://<host>:3001` (plain HTTP; bypasses ingress)
- Grafana through frontend subpath: `https://<your-domain>/grafana`
- Admin monitoring page: `https://<your-domain>/admin/monitoring`

## Important subpath settings

Grafana is configured to run under `/grafana` to avoid broken asset paths when accessed through Next.js rewrite:

- `GF_SERVER_DOMAIN=${GRAFANA_DOMAIN:-pd.lu.im.ntu.edu.tw}`
- `GF_SERVER_ROOT_URL=${GRAFANA_ROOT_URL:-https://pd.lu.im.ntu.edu.tw/grafana/}`
- `GF_SERVER_SERVE_FROM_SUB_PATH=true`

If you change the proxy path, update both Grafana env settings and `apps/frontend/next.config.mjs` rewrites together.

## Optional frontend env overrides

- `NEXT_PUBLIC_GRAFANA_EMBED_PATH` (for iframe path)
- `NEXT_PUBLIC_GRAFANA_PUBLIC_URL` (optional absolute URL for external open button)

## Kubernetes cutover (deferred)

Grafana, Prometheus, Loki, and Promtail are defined in [`docker-compose.observability.yml`](../../docker-compose.observability.yml) only. They are **not** deployed in `k8s/` yet.

After moving app traffic to Kubernetes:

- `/grafana` and `/admin/monitoring` return errors because the frontend rewrites to `http://grafana:3000`, which does not exist inside the cluster.
- `npm run docker:up:obs` still starts the Compose observability stack on the host, but it will not be reachable from K8s frontends until `GRAFANA_INTERNAL_URL` points at a reachable endpoint (or observability is migrated into K8s).
- Prometheus in the Compose stack scrapes `backend:8000` on the **Compose** network (`ops/observability/prometheus/prometheus.yml`). After app cutover to K8s, host-side observability does not collect metrics from K8s backends until scrape targets are reconfigured or the stack is migrated.

**Deferred follow-up:** tracked as [PROD-001](../backlog/product.md#prod-001-observability-on-kubernetes) in [`backlog/`](../backlog/README.md) — add Grafana (+ Prometheus/Loki) to K8s, or run observability as a host-side Compose stack and wire `GRAFANA_INTERNAL_URL` in frontend ConfigMaps for dev/prod. Until then, treat monitoring as unavailable on K8s-hosted domains.
