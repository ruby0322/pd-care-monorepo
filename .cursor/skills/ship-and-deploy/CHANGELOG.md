# ship-and-deploy changelog

Track skill updates separately from application commits so drift is auditable.

| Date | Version | Commit audited | Change |
| --- | --- | --- | --- |
| 2026-07-02 | 1.3.1 | c444385 | Remove `docker-compose.gpu.yml` and `docker:up:gpu` references from skill and docs |
| 2026-07-02 | 1.3.0 | c444385 | Document prod FE/BE zero-downtime rolling (replicas 2, migrate Job, PDB, continuous curl verify); add k8s-zero-downtime-rollout runbook and prod overlay sources to manifest |
| 2026-07-02 | 1.2.2 | a63b445 | Add prod backend migrate-Job deploy sequence for zero-downtime rolling and refresh audit metadata |
| 2026-07-01 | 1.2.1 | a63b445 | Document backend model-bake command, remove model-cache volume references, and refresh manifest source paths |
| 2026-07-01 | 1.2.0 | bd941dc | Add ask-first deploy disambiguation (Compose vs K8s dev/prod); document K8s redeploy paths, ingress health checks, PVC safety |
| 2026-06-28 | 1.1.0 | bd941dc | Add production data safety rules and scoped redeploy as default (no full-stack down by default) |
| 2026-06-28 | 1.0.0 | bd941dc | Initial skill: git ship workflow, docker redeploy modes, manifest + audit script |
