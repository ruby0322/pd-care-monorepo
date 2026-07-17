---
name: k8s-minikube-recovery
description: >-
  Recover PD Care Minikube after host reboot, disk pressure, or bind-mount
  volume moves; restore control plane when /etc/kubernetes was lost with a
  recreated Minikube container; keep production PVC/etcd data safe. Use when
  the user reports K8s/Minikube down after reboot, no route to the API server,
  disk-full blocking minikube start, migrating pd-care volumes to a larger
  filesystem, CNI NotReady, or missing bootstrap-kubelet.conf / empty manifests.
---

# K8s Minikube recovery (PD Care)

Follow the runbook: [`docs/ops/k8s-minikube-volume-migration-and-recovery.md`](../../../docs/ops/k8s-minikube-volume-migration-and-recovery.md).

Day-to-day deploy/ingress details stay in [`docs/deploy/k8s-minikube.md`](../../../docs/deploy/k8s-minikube.md). This skill is for **storage moves** and **disaster recovery**, not routine rollouts (use [ship-and-deploy](../ship-and-deploy/SKILL.md)).

## Privacy / redaction

When writing notes, PRs, or chat summaries:

- Prefer placeholders (`$DATA_ROOT`, “operator host”, “large filesystem mount”).
- Do **not** paste host inventory (other users’ directories, block device IDs, lab-internal hostnames, credentials, or full `daemon.json` / secret contents).
- Public product hostnames already documented in deploy runbooks may be used for smoke tests.

## Mandatory safety

- Never `minikube delete` to “fix” a volume move or reboot.
- Never `kubectl delete pvc` / wipe Postgres or SeaweedFS for control-plane or disk-pressure fixes.
- Never `docker system prune --volumes` on a shared Docker host without explicit approval.
- Prefer binding **only** pd-care volumes (especially `minikube`) over relocating the whole Docker `data-root` on a shared daemon.
- Prefer `minikube stop` / `minikube start` over `docker rm minikube`.

## Decision tree (agent)

1. **Can `kubectl` reach the API?**
   - No → `minikube status`; if stopped, check `df` then `minikube start`. If start fails on disk, reclaim safe space (build cache / unused images) or plan a bind-mount move (runbook §B).
   - Yes → continue.
2. **Is the node Ready?**
   - No + `cni config uninitialized` → restore CNI (runbook §C).
   - No + kubelet missing `/etc/kubernetes/*` → restore bootstrap backup or kubeadm phases (runbook §C); **do not** wipe etcd under `/var/lib/minikube`.
3. **Are prod/dev workloads up?**
   - Delete only stuck pods that controllers should recreate; restart `deploy/backend` **after** Postgres is Ready.
4. **Public ingress?**
   - Restart `docker-compose.ingress-bridge.yml` with `MINIKUBE_IP="$(minikube ip)"`; smoke HTTP 200 on prod/test sites.

## Volume migration checklist (agent)

When the user asks to move pd-care data to a larger disk:

1. Confirm scope: **K8s production data = Docker volume `minikube`**, not host Compose `pd-care_seaweed-*` alone.
2. Agree `$DATA_ROOT` with the user (directory they own on the large mount).
3. Stop Minikube + compose writers → copy volumes → verify file counts / `du -sb` → recreate **same-named** bind volumes → start → verify `docker volume inspect` `device` path.
4. If the Minikube container was removed, run control-plane restore before expecting pods.
5. After success, refresh `$DATA_ROOT/minikube-bootstrap/` from the live `/etc/kubernetes` + CNI + kubelet drop-in.

## Insights (do not rediscover the hard way)

- Host Compose SeaweedFS/Postgres ≠ K8s PVC SeaweedFS/Postgres.
- `/etc/kubernetes` lives in the **container layer**; the `minikube` volume mounts at `/var`.
- Sparse PV files can make `du -sh` look “too small” on the destination; compare counts and byte totals.
- Tar may skip sockets; that is expected.
- Backend often crashes once if it starts before Postgres after a mass pod recreate — rollout restart backends when DB is Ready.

## Related

- Runbook: [`docs/ops/k8s-minikube-volume-migration-and-recovery.md`](../../../docs/ops/k8s-minikube-volume-migration-and-recovery.md)
- Deploy: [`docs/deploy/k8s-minikube.md`](../../../docs/deploy/k8s-minikube.md)
- Prod rolling: [`docs/deploy/k8s-zero-downtime-rollout.md`](../../../docs/deploy/k8s-zero-downtime-rollout.md)
- Ship/deploy safety: [`../ship-and-deploy/SKILL.md`](../ship-and-deploy/SKILL.md)
