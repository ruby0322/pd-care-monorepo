# Minikube volume migration and disaster recovery

Operational notes for PD Care on Minikube (docker driver): moving pd-care Docker volumes onto a larger filesystem, recovering after host reboot or a wiped Minikube **container layer**, and verifying production data safety.

Canonical day-to-day deploy flow remains [`../deploy/k8s-minikube.md`](../deploy/k8s-minikube.md). This doc covers **host storage moves** and **control-plane recovery** only.

## Architecture reminders (data locations)

| What | Where it lives | Notes |
| --- | --- | --- |
| `pd-care-prod` / `pd-care-dev` Postgres, SeaweedFS, app PVC data | Inside the Docker named volume `minikube` (cluster disk: kubelet, etcd, hostpath PVs) | This is the production-like data plane when K8s is the active path |
| Host Compose infra (`postgres`, SeaweedFS, model cache, …) | Named volumes `pd-care_*` on the Docker host | Separate from K8s PVCs; often leftover local/`dev:infra` stacks |
| Ingress bridge (`:80` / `:443` → ingress NodePorts) | Compose file `docker-compose.ingress-bridge.yml` — **no** durable volume | Must be restarted after host reboot if not managed by a unit |
| Minikube profile / client certs | Operator home `~/.minikube` | Small; not a substitute for the `minikube` volume |
| Control-plane static manifests + kubeconfigs under `/etc/kubernetes` | **Container writable layer**, not the `minikube` volume | Lost if the Minikube container is removed (`docker rm`) even when the volume survives |

**Do not** confuse host Compose SeaweedFS/Postgres with K8s namespace workloads. Migrating only `pd-care_*` host volumes does **not** move K8s production data; migrating `minikube` does.

## Safety rules

- Prefer **`minikube stop` / `minikube start`**. Avoid `docker rm minikube` unless you have a bootstrap restore path (below).
- Never `minikube delete` during a volume move — that destroys cluster state.
- Migrate with **copy → verify → recreate bind volume → start**. Do not delete the source volume until verification passes.
- On a **shared** Docker daemon host, prefer binding **only** pd-care volumes (especially `minikube`) to a large filesystem. Moving the entire Docker `data-root` affects every user of that daemon and needs host admin + coordinated downtime.
- Do not `kubectl delete pvc` / wipe Postgres or SeaweedFS for frontend-only or recovery-of-control-plane issues.
- After recovery, restart **application** backends only after Postgres (and needed deps) are Ready — startup probes fail hard if the DB is still down.

## Symptom → likely cause

| Symptom | Likely cause |
| --- | --- |
| `kubectl` → `no route to host` / connection refused to the cluster API | Minikube VM/container stopped after host reboot, or apiserver never came up |
| `minikube start` → Docker / disk capacity error | Root (or Docker data) filesystem nearly full |
| Cluster up but almost all pods `Error` / briefly recover then fail | Normal after reboot until kubelet settles; or disk pressure / OOM |
| `minikube start` fails with apiserver never appearing; kubelet loops on missing `bootstrap-kubelet.conf` | `/etc/kubernetes` missing after container recreate |
| Node `NotReady`; kubelet: `cni config uninitialized` | `/etc/cni/net.d` lost with container layer |
| Frontend/ingress HTTP 200 but backend CrashLoop / exit on DB connect | Postgres came up later than backend; rollout restart backends |
| `du` on destination much smaller than source for hostpath PV trees | Often **sparse** files: compare `find … \| wc -l` and `du -sb`, not only `du -sh` |

## A) After host reboot (routine)

1. Check disk: `df -h` on `/` and on the large data mount (if used).
2. `minikube status` → if stopped: `minikube start` (ensure ingress addon still enabled per deploy runbook).
3. `kubectl get nodes` / `kubectl get pods -A` — wait for Ready; delete stuck `Completed`/`Error` pods only if controllers do not recreate them.
4. Restart ingress bridge from the repo root:

   ```bash
   MINIKUBE_IP="$(minikube ip)" docker compose -f docker-compose.ingress-bridge.yml up -d
   ```

5. Smoke: public prod/dev URLs return HTTP 200; a bad login POST should hit the API (e.g. 4xx), not a gateway blank failure.

If start fails on disk space, free reclaimable Docker build cache / unused images **without** pruning volumes that hold pd-care or `minikube` data, or proceed to section B.

## B) Move pd-care volumes to a larger filesystem (bind mounts)

Goal: keep the **system** Docker `data-root` unchanged; relocate only pd-care-related named volumes onto a large mount.

Example layout (adjust `$DATA_ROOT` to the operator-chosen directory on the large filesystem):

```text
$DATA_ROOT/
  docker-volumes/
    minikube/
    pd-care_postgres-data/
    pd-care_model-cache/
    pd-care_seaweed-master-data/
    pd-care_seaweed-volume-data/
    pd-care_seaweed-filer-data/
    … (other pd-care_* volumes as needed)
  minikube-bootstrap/          # optional: restore artifacts for /etc/kubernetes + CNI
```

### Steps

1. **Stop writers**

   ```bash
   minikube stop
   docker compose -f docker-compose.ingress-bridge.yml stop
   docker compose stop   # if host Compose pd-care stack is running
   ```

2. **Remove containers that hold the volumes** (volumes themselves stay until step 5):

   ```bash
   docker rm -f minikube   # only if needed to release the volume; prefer stop-only when possible
   # remove stopped pd-care-* compose containers as needed
   ```

   If you remove the Minikube container, plan on section C after volumes are rebound.

3. **Copy** each volume into `$DATA_ROOT/docker-volumes/<name>/` via a helper container (preserves ownership):

   ```bash
   docker run --rm \
     -v "<volume_name>:/from:ro" \
     -v "$DATA_ROOT/docker-volumes/<volume_name>:/to" \
     alpine:3.20 sh -c 'cd /from && tar cf - . | tar xf - -C /to'
   ```

   Expect tar warnings about **sockets** (ignored) — normal.

4. **Verify** before deleting old volumes:

   - File counts under critical trees (e.g. hostpath provisioner namespaces) match.
   - `du -sb` (apparent/byte totals) are close; do not panic solely on `du -sh` mismatches with sparse data.
   - Confirm `minikube` copy includes etcd + hostpath data under the volume’s `/var` tree.

5. **Recreate named volumes as bind mounts** (same names Docker/Minikube expect):

   ```bash
   docker volume rm <volume_name>
   docker volume create \
     --driver local \
     --opt type=none \
     --opt o=bind \
     --opt device="$DATA_ROOT/docker-volumes/<volume_name>" \
     <volume_name>
   ```

6. **Start** Minikube and ingress bridge; if `/etc/kubernetes` was wiped by container recreate, run section C first.

7. Confirm:

   ```bash
   docker volume inspect minikube --format '{{index .Options "device"}}'
   # should print the path under $DATA_ROOT
   kubectl get pods -n pd-care-prod
   ```

### Optional: free space on the old filesystem

Only after the cluster has been healthy on the new binds: Docker will have dropped the old volume contents when `docker volume rm` succeeded. Confirm `df` on the root filesystem improved. Do not run broad `docker system prune --volumes`.

## C) Recover control plane after Minikube container recreate

When the **`minikube` volume is intact** but the container was recreated, `/var` (certs, etcd, PVCs) survives while `/etc/kubernetes` and often CNI config do not.

### C.1 Restore from bootstrap backup (preferred)

If `$DATA_ROOT/minikube-bootstrap/` (or equivalent) holds a prior copy of:

- `etc-kubernetes/` (admin/kubelet confs + `manifests/*.yaml`)
- CNI conflist (e.g. bridge `10.244.0.0/16`)
- kubelet drop-in **without** requiring a missing `bootstrap-kubelet.conf`

…copy them into the running Minikube container and restart `kubelet` (and the CRI/docker shim as needed). Keep a small `restore.sh` next to those files on the large disk.

### C.2 Rebuild manifests with kubeadm (no backup)

Inside the node (via `minikube ssh`), using binaries under `/var/lib/minikube/binaries/<version>/` and **existing** `certificatesDir` + etcd `dataDir` under `/var/lib/minikube/`:

1. Write an Init/ClusterConfiguration matching this cluster (advertise address = node IP, API bind port as configured for this Minikube profile, `criSocket` for cri-dockerd, pod/service CIDRs as previously used).
2. Run only:

   - `kubeadm init phase kubeconfig all`
   - `kubeadm init phase control-plane all`
   - `kubeadm init phase etcd local`

   Do **not** wipe `/var/lib/minikube/etcd`.

3. Ensure kubelet does not require a missing bootstrap kubeconfig (edit the kubelet systemd drop-in to use `/etc/kubernetes/kubelet.conf` only, then `daemon-reload` + restart kubelet).
4. Restore CNI: write a bridge conflist named consistently with prior IPAM under `/var/lib/cni/networks/bridge` (typically pod CIDR `10.244.0.0/16` for default Minikube bridge). Restart cri-dockerd/kubelet until the node is Ready.
5. Force recreation of stuck app pods if they remain `Completed`/`Error`; `kubectl rollout restart deploy/backend` in each namespace **after** Postgres is Ready.
6. Bring ingress bridge back; smoke-test public URLs.

After a successful C.2, **immediately** copy `/etc/kubernetes`, CNI conflist, and kubelet drop-in into `$DATA_ROOT/minikube-bootstrap/` so the next incident can use C.1.

## D) Verification checklist

- [ ] `minikube status`: host / kubelet / apiserver running
- [ ] `kubectl get nodes`: Ready
- [ ] `pd-care-prod` and `pd-care-dev`: Postgres, SeaweedFS, frontend, backend Ready (or progressing)
- [ ] Ingress controller Running; bridge containers Up
- [ ] Prod and test site HTTP 200; API reachable (auth error on empty body is OK)
- [ ] `docker volume inspect minikube` shows bind `device` under the large filesystem when migration was the goal
- [ ] Bootstrap backup present if container-layer files were regenerated

## Related docs

- [`../deploy/k8s-minikube.md`](../deploy/k8s-minikube.md) — deploy, ingress bridge, dual namespace
- [`../deploy/k8s-zero-downtime-rollout.md`](../deploy/k8s-zero-downtime-rollout.md) — prod rolling upgrades
- [`../deploy/k8s-migration.md`](../deploy/k8s-migration.md) — Compose → K8s data cutover (different problem)
- Agent skill: [`.cursor/skills/k8s-minikube-recovery/SKILL.md`](../../.cursor/skills/k8s-minikube-recovery/SKILL.md)
