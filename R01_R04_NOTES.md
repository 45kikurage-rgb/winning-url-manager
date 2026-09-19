# R-01〜R-04 PWA notes

## Local tree (complete — source of truth)
`/workspace/winning-url-manager`
Related tests: **41/41** (prior full Nova suite 64/64).

## Key edits (must be full blobs on branch before merge)
- `home-layout.html`: sync `screen` / `cell_x` / `cell_y` on 初期データ登録
- `share.html`: `nextRequestId` / reuse on auth/retry (keep Player UI v3)
- `home-layout-marker-core.js`: 121–150 LINE guard
- tests updated

## Parent
This PR may still be notes-only or partial. Push remaining full files from the local tree so Cloudflare+GitHub stay aligned. MCP large HTML/JS pushes were unreliable.

Pair with API PR #8; do not enable server edit until 初期座標再登録 after API deploy.
