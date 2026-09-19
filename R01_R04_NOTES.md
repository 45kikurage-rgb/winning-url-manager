# R-01〜R-04 PWA notes

Production PR for the PWA side of the R-01〜R-04 gate. Pair with API PR #8. Do not merge until 初期座標再登録 is planned after the API deploy.

## Included (same as staging PWA, minus staging-only UI)

- `home-layout.html` — initial `/api/layout/accounts/sync` sends `screen` / `cell_x` / `cell_y`
- `home-layout-marker-core.js` — 5-page new layout is 121–150 LINE only
- `layout-backup-share.js` — `createJob` sends form `requestId` + `X-Request-Id` (already on main)
- `share.html` — new backup file rotates `requestId`; auth/retry reuses it
- Tests: `tests/home-layout-r02-sync.test.js`, `tests/layout-backup-share.test.js`, `tests/home-layout-marker-core.test.js`

## Intentionally not included

Staging-only surface: `【検証】` banner, `managerKeyBtn`, Pages.dev / `winning-url-api-staging` API URL, staging cache-bust. Production API remains `https://winning-url-api.45kikurage.workers.dev`.
