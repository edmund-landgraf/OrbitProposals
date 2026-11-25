# Unwhelm VPS deploy and recovery

Repo: `/home/administrator/node-sites/UnwhelmNet20` on `vps-unwh`.

## Processes (PM2)
| Process | Port | Entry |
|---|---|---|
| unwh-api | 3201 | `dist-api/server/index.js` |
| unwh-mcp | 3202 | `unwh-mcp/dist/unwh-mcp/src/http.js` |
| unwhelm-redesign | 3200 | `server.mjs` (website) |
| unwhelm-net | 3100 | legacy site ? do **not** restart with UnwhelmNet20 deploys |

nginx: `unwhelm.net/api/v1` and `/.well-known/oauth-*` go to 3201, `/` to 3200, `mcp.unwhelm.net/mcp` to 3202.

## Hard rule (read this)
**Never `pm2 restart unwh-api` (or the sibling UnwhelmNet20 apps) until `npm install`/`npm ci`, `prisma generate`, and `npm run build:all` have all finished successfully.**

Restarting on a half-built tree historically wiped `node_modules` / `.prisma/client` and put unwh-api into a MODULE_NOT_FOUND crash loop (`Cannot find module '.prisma/client/default'`). That inflated the PM2 restart counter; it was not a mystery OOM.

Preferred path: run the wrapper so order is enforced:

```bash
cd /home/administrator/node-sites/UnwhelmNet20
bash scripts/deploy-vps.sh
# options: --ci  --migrate  --skip-pull
```

## Standard deploy (manual ? same order as the script)
```bash
cd /home/administrator/node-sites/UnwhelmNet20
git pull --ff-only origin main
npm install                 # or: npm ci
npx prisma generate --schema prisma/schema.prisma   # ALWAYS after install (postinstall also runs this)
npx playwright install chromium                     # PDF export; cache is outside node_modules
npx prisma migrate deploy   # only if there are new migrations
npm run build:all           # MUST finish before any PM2 restart
pm2 restart unwh-api unwh-mcp unwhelm-redesign --update-env
sleep 3 && ss -ltn | grep -E '320[0-2]'
```

## Check health
Do not trust `pm2 status` alone. unwh-api can show "online" while crash-looping or never binding its port.
```bash
ss -ltn | grep -E '320[0-2]'          # all three ports should be listening
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3201/api/v1/catalog   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3201/api/v1/public/demo/plans
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3200/try
pm2 describe unwh-api | egrep 'status|restarts|unstable|uptime'
pm2 logs unwh-api --err --lines 30 --nostream
```
A rising **unstable** restart count (not the lifetime ? column alone) means a crash loop. Lifetime ? also increments on every intentional deploy restart.

## Known failures
- **`Cannot find module '.prisma/client'` (MODULE_NOT_FOUND):** install/restart raced ahead of `prisma generate`. Fix: `npx prisma generate && npm run build:api && pm2 restart unwh-api --update-env`. Prevention: use `scripts/deploy-vps.sh`; `package.json` already has `"postinstall": "prisma generate"`.
- **API surface count mismatch at startup:** fixed in 84344b8 (coverage check instead of hard-coded count). If routes are added, make sure each appears in `API_SURFACE`.
- **New MCP tools not showing:** unwh-mcp runs the built file. Rebuild (`npm run build:all`) and restart unwh-mcp.
- **Proposal/contract PDF returns 500, `Executable doesn't exist`:** Chromium was never installed, or a Playwright upgrade removed the previous browser from `~/.cache/ms-playwright`. Fix: `npx playwright install chromium` in the repo. `scripts/deploy-vps.sh` runs that after install.
- **`SESSION_SECRET is required in production`:** `UNWH_SESSION_SECRET` missing from the env.
- **`Can't reach database server at 127.0.0.1:5432`:** request-time 500s while Postgres is down; does **not** by itself restart PM2. Check `ss -ltn | grep 5432`.

## Archive and clear logs
```bash
A=~/.pm2/logs/archive; mkdir -p $A; TS=$(date +%Y%m%d-%H%M%S)
tar czf $A/unwh-api-logs-$TS.tar.gz -C ~/.pm2/logs unwh-api-out.log unwh-api-error.log
pm2 flush unwh-api
```
