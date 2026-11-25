#!/usr/bin/env bash
# UnwhelmNet20 VPS deploy ? install/generate/build MUST finish before any PM2 restart.
# Never restart unwh-api (or siblings) on a half-built tree; that historically caused
# MODULE_NOT_FOUND crash loops on .prisma/client when node_modules was wiped mid-deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_MIGRATE=0
DO_CI=0
SKIP_PULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate) DO_MIGRATE=1 ;;
    --ci) DO_CI=1 ;;
    --skip-pull) SKIP_PULL=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-pull] [--ci] [--migrate]"
      echo "  Default: git pull, npm install, prisma generate, build:all, then pm2 restart."
      echo "  --ci        use npm ci (clean install) instead of npm install"
      echo "  --migrate   also run prisma migrate deploy before build"
      echo "  --skip-pull do not git pull (use current tree)"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
  shift
done

echo "==> repo: $ROOT"
echo "==> HEAD before: $(git log -1 --oneline)"

if [[ "$SKIP_PULL" -eq 0 ]]; then
  echo "==> git pull origin main (ff-only)"
  git pull --ff-only origin main
  # Keep VPS-local package-lock overrides from clobbering a clean tree when present
  if git status --porcelain | grep -q 'package-lock.json'; then
    echo "==> restoring package-lock.json to HEAD (local churn)"
    git checkout -- package-lock.json || true
  fi
fi

echo "==> HEAD now: $(git log -1 --oneline)"

if [[ "$DO_CI" -eq 1 ]]; then
  echo "==> npm ci"
  npm ci
else
  echo "==> npm install"
  npm install
fi

# postinstall runs prisma generate, but keep an explicit step so a missing postinstall
# or a skipped lifecycle script can never leave .prisma/client absent.
echo "==> npx prisma generate"
npx prisma generate --schema prisma/schema.prisma

# PDF routes launch Playwright Chromium. The browser lives in ~/.cache/ms-playwright,
# not node_modules, and a Playwright upgrade deletes the previous build.
echo "==> npx playwright install chromium"
npx playwright install chromium

if [[ "$DO_MIGRATE" -eq 1 ]]; then
  echo "==> npx prisma migrate deploy"
  npx prisma migrate deploy
fi

echo "==> npm run build:all (must finish before PM2 restart)"
npm run build:all

echo "==> pm2 restart unwh-api unwh-mcp unwhelm-redesign --update-env"
pm2 restart unwh-api unwh-mcp unwhelm-redesign --update-env

echo "==> wait for listeners"
sleep 3
ss -ltn | grep -E '320[0-2]' || true

echo "==> health curls"
curl -sS -o /dev/null -w "catalog %{http_code}\n" http://127.0.0.1:3201/api/v1/catalog || true
curl -sS -o /dev/null -w "demo/plans %{http_code}\n" http://127.0.0.1:3201/api/v1/public/demo/plans || true
curl -sS -o /dev/null -w "try %{http_code}\n" http://127.0.0.1:3200/try || true

echo "==> done. pm2:"
pm2 list | sed -n '1,12p'
