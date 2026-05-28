# GitHub Setup Required (Before Go-Live)

This checklist covers what must be configured in GitHub for the workflows in this repository.

## 1) Repository Actions Permissions

In repository settings:

- Actions permissions: allow GitHub Actions to run
- Workflow permissions: **Read and write permissions**
- Enable: **Allow GitHub Actions to create and approve pull requests** (recommended)

Reason: tag update/promotion workflows commit changes to `dev` and `main`.

## 2) GHCR Package Access

- Package path used: `ghcr.io/ruby0322/pd-care-backend`
- Ensure this repository can publish to and read from this package.
- If package is private, grant repository Actions access to the package.

## 3) Branch Protection Rules

### `dev`
- Require pull request before merging
- Require at least 1 approval
- Require status checks:
  - `GitOps Validate / helm-template-validate`

### `main`
- Require pull request before merging
- Require status checks:
  - `GitOps Validate / helm-template-validate`
- Block direct pushes (recommended for production safety)

Note: if direct pushes to `main` are blocked, promotion should be adjusted to PR-based automation.

## 4) Required Runtime Secrets / Variables

No custom secret is required for GHCR publish when using `${{ secrets.GITHUB_TOKEN }}` and correct permissions.

If GHCR is private for cluster pull:
- Create Kubernetes `imagePullSecret` in both namespaces (`sit`, `prod`)
- Configure `image.pullSecrets` in env values (for example `["ghcr-creds"]`)

## 5) Information Needed To Finalize

Provide these values to complete environment-specific setup:

1. Production cluster API server URL (for `ops/gitops/argocd/apps/prod-app.yaml`)
2. Whether GHCR package will be public or private
3. If private: Kubernetes secret name used in `sit` and `prod` for GHCR pull
4. Confirm whether automation may push directly to `main`; if not, switch promotion workflow to PR mode
