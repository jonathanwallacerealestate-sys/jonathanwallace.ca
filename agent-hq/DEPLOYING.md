# Deploying Agent HQ

There is **one** deploy path. Don't add a second one.

## How to deploy

```bash
git push origin main
```

Railway watches `main` and auto-deploys to **hq.jonathanwallace.ca** in ~90 seconds.

That's it.

## How to roll back

```bash
git revert <bad-sha>
git push origin main
```

Railway re-deploys the previous good state in ~90 seconds.

## Why this is the only path

- `git log` and the GitHub UI **are** the deploy history. No second log to maintain.
- `git revert` is the rollback. Industrial-strength, no custom code.
- One credential to rotate (the GitHub repo access). The previous setup needed two (`GITHUB_DEPLOY_TOKEN` + `DEPLOY_SECRET`).
- Anyone who has shipped a web app understands the flow. Bespoke deploy endpoints don't carry that benefit.
- Branches and pull requests are free if we ever want them.

## What was retired (2026-04-24)

A previous setup gave Claude a custom path: `POST /api/admin/deploy` plus a Drive-backed spool. It was useful for one specific environment where Claude couldn't reach GitHub from chat. In Cowork mode, `git push` works, so the alternate is gone:

- Endpoints removed: `POST /api/admin/deploy`, `GET /api/admin/deploy/status`, `GET /api/admin/deploy/spool/status`
- Library files removed: `agent-hq/lib/github-deploy.js`, `agent-hq/lib/deploy-spool.js`
- Smoke-test file removed: `agent-hq/.deploy-service-smoketest`

## Railway env vars you can delete

Now safe to remove from Railway (Project → Variables) — they have no consumer:

- `DEPLOY_SECRET`
- `DEPLOY_SPOOL_PENDING_FOLDER_ID`
- `DEPLOY_REPO_OWNER` (default in code is fine)
- `DEPLOY_REPO_NAME` (default in code is fine)
- `DEPLOY_BRANCH` (default in code is fine)

**Keep** `GITHUB_DEPLOY_TOKEN` only if some other tool (a Make.com scenario, a script on your laptop) still uses it. Otherwise, you can revoke the PAT entirely — `git push` from your laptop or this Cowork session uses Git's normal credentials, not that token. The PAT was scheduled to expire **May 22, 2026**; rotation no longer needed if it's unused.

## Pre-push checks (CI)

`.github/workflows/ci.yml` runs on every push to `main`:

- `node --check server.js` — server-side syntax
- `npm run build` — the Vite client build

A red CI run does **not** stop Railway from deploying. To make CI gating hard:

1. Railway → Project → Settings → Deploys → **Wait for CI checks**
2. Mark the `CI` check as **required** in GitHub branch protection (Settings → Branches)

## Branching (optional, when a change is risky)

```bash
git checkout -b feat/something
# ... edits, commits
git push origin feat/something
# Open a PR on GitHub, get it green in CI, then "Squash and merge" to main.
```

Branches do not auto-deploy. Only `main` does.

## Rules of the road

- **Never** push directly to Railway via the Railway CLI. The source of truth is GitHub.
- **Never** use `--no-verify` or `--no-gpg-sign` on commits unless explicitly cleared.
- **Never** force-push to `main`.
- **Never** introduce a second deploy mechanism. We had one and it's gone.

## In an emergency

If a bad commit is on `main` and Railway has crashed, Railway's UI will let you redeploy a prior build directly. That's still a non-`git`-shaped action; only do it when you can't get a `git revert` push out fast enough.
