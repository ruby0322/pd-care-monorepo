# ship-and-deploy changelog

Track skill updates separately from application commits so drift is auditable.

| Date | Version | Commit audited | Change |
| --- | --- | --- | --- |
| 2026-07-01 | 1.2.1 | 0a7d9e2 | Document backend model-bake command, remove model-cache volume references, and refresh manifest source paths |
| 2026-07-01 | 1.2.0 | bd941dc | Add ask-first deploy disambiguation (Compose vs K8s dev/prod); document K8s redeploy paths, ingress health checks, PVC safety |
| 2026-06-28 | 1.1.0 | bd941dc | Add production data safety rules and scoped redeploy as default (no full-stack down by default) |
| 2026-06-28 | 1.0.0 | bd941dc | Initial skill: git ship workflow, docker redeploy modes, manifest + audit script |
