当選URL管理・共有送信版

このZIPは、一時箱・全ファイル重複確認・コピー制限に対応しています。
必ず winning-url-api を先にデプロイしてから更新してください。

GitHub の winning-url-manager へ以下7ファイルを上書きアップロード:
- index.html
- share.html
- home-layout.html
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

ホーム画面更新（仮ページ）:
1. 管理画面上部の「ホーム画面更新」を押す
2. 「ファイル貼りつけ」「編集」「読み込み」の3入口を確認する
3. .novabackupをAndroid共有から受け取った場合も、この仮ページを開く

現在は画面構成確認用です。選択・共有したバックアップは端末内へ仮保存します。
サーバー送信、配置編集、復元ファイル作成は未接続です。
旧NOVA配置照合・CSV・AI確認用JSON作成機能は削除済みです。

新規URLは一時箱へ受付されます。
管理画面の「全ファイル重複チェック」または毎日6:30・22:00の自動確認後、
ユニークURLだけが継続箱、収益、コピー対象へ反映されます。
