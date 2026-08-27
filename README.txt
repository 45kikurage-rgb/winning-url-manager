当選URL管理・共有送信版

GitHub の winning-url-manager へ以下6ファイルを上書きアップロード:
- index.html
- share.html
- manifest.webmanifest
- sw.js
- icon-any.png
- icon-maskable.png

Cloudflare は GitHub 更新後に自動デプロイされます。

Android:
1. Chromeで https://winning-url-manager.45kikurage.workers.dev を開く
2. 既存のホーム画面ショートカット/PWAがある場合は一度削除
3. Chromeメニューから「アプリをインストール」または「ホーム画面に追加」
4. 対象ページで「共有」
5. 共有先に「URL送信」または「当選URL管理」が表示されたら選択
6. share.html が起動し、自動的に現在選択中の保存先へ送信
