# R-01〜R-04 PWA notes

## Local tree (complete — source of truth)
`/workspace/winning-url-manager`

## Branch status (restored)
Full blobs pushed from local tree to `fix/r01-r04-audit-safety` (pair with API PR #8; do not merge until coords re-registration plan is ready):

- `home-layout.html` — sync `screen` / `cell_x` / `cell_y`
- `home-layout-marker-core.js` — 121–150 LINE guard
- `layout-backup-share.js` — requestId support; keep inspect-ui-v3
- `share.html` — `nextRequestId` / reuse on auth/retry; keep Player UI v3
- `tests/layout-backup-share.test.js`, `tests/home-layout-marker-core.test.js`

## Parent
Pair with API PR #8; do not enable server edit until 初期座標再登録 after API deploy.
