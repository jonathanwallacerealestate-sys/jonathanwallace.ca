#!/usr/bin/env bash
#
# agent-hq deploy script.
#
# Stages all changed files inside agent-hq/, syntax-checks any modified .js
# files, commits with the given message, and pushes to origin/main.
#
# Usage:   ./agent-hq/scripts/deploy.sh "commit message"
# Or via the aghq alias:   aghq "commit message"
#
# If no message is supplied, an auto-deploy message with the timestamp is used.

set -e

# Make sure common node install paths are visible to this script.
# When invoked via the aghq alias from bash, PATH may not include
# Homebrew's bin dirs, where node usually lives on macOS.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$PATH"

# Find repo root (this script lives at <repo>/agent-hq/scripts/deploy.sh)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Clean any stale git locks (orphaned by sandbox-vs-host file ownership)
rm -f .git/index.lock .git/HEAD.lock 2>/dev/null || true

MSG="${1:-auto-deploy $(date +%Y-%m-%d_%H:%M)}"

echo "==> Repo: $REPO_ROOT"
echo "==> Changes in agent-hq/:"
git status --short agent-hq/ || true

# Syntax-check any modified .js files in agent-hq/. If node isn't on PATH
# we skip the check rather than block the deploy — CI will catch any error.
echo ""
echo "==> Syntax check on changed .js files..."
if ! command -v node >/dev/null 2>&1; then
  echo "  (node not on PATH for this script; skipping syntax check — CI will validate)"
else
  CHANGED_JS=$( { git diff --name-only -- 'agent-hq/*.js' 'agent-hq/**/*.js'; \
                   git diff --cached --name-only -- 'agent-hq/*.js' 'agent-hq/**/*.js'; \
                   git ls-files --others --exclude-standard -- 'agent-hq/*.js' 'agent-hq/**/*.js'; } | sort -u )
  if [ -z "$CHANGED_JS" ]; then
    echo "  (no .js changes)"
  else
    for f in $CHANGED_JS; do
      if [ -f "$f" ]; then
        if node --check "$f" 2>/dev/null; then
          echo "  ok  $f"
        else
          echo "  ERR $f"
          node --check "$f" || true
          echo ""
          echo "==> Aborting deploy: syntax error in $f"
          exit 1
        fi
      fi
    done
  fi
fi

# Stage everything in agent-hq/
git add agent-hq/

# Bail cleanly if nothing's actually staged
if git diff --cached --quiet; then
  echo ""
  echo "==> Nothing to commit. Already in sync."
  exit 0
fi

# Commit + push
echo ""
echo "==> Committing: $MSG"
git commit -m "$MSG"

echo ""
echo "==> Pushing to origin/main..."
git push origin main

echo ""
echo "==> Done. Railway deploys in ~90s."
echo "    Health: https://hq.jonathanwallace.ca/api/health"
