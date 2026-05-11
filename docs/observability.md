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

- Grafana direct (port mapped): `https://<your-domain>:3001`
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
