当選URL管理・共有送信版

このZIPは、一時箱・全ファイル重複確認・コピー制限に対応しています。
必ず winning-url-api を先にデプロイしてから更新してください。

GitHub の winning-url-manager へ以下10ファイルを上書きアップロード:
- index.html
- share.html
- home-layout.html
- home-layout-edit.html
- home-layout-read.html
- home-layout-admin.html
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

ホーム画面更新:
1. 画面下部の「画面配置／管理画面」を押す
2. 初期データと抽選後データの.novabackupを貼りつける
3. 編集画面で端末01〜15、2ファイル、キャンペーン、当落、作業範囲を選ぶ
4. 1ページ目の7段目にある全LINEを確認し、当落をサーバーへ登録する
5. 更新ファイルを作成し、.novabackupを直接ダウンロードする

端末06は専用データとして保存します。アプリIDは初期データ内の実在値だけを使い、
初期データに存在しないアプリIDは追加ページへ配置しません。
1～6段目は初期データのLINE配置へ戻し、最下部のドックは抽選後データの状態を維持します。
キャンペーンごとの当落はサーバーへ保存し、外れLINEだけを最終ページの次から初期配置の優先順で5×6配置します。
作成ファイル名は「MMDD_HHmm_端末XX_キャンペーン名_編集済.novabackup」です。通常作業ではZIPを作成しません。
旧NOVA配置照合・CSV・AI確認用JSON作成機能は削除済みです。

新規URLは一時箱へ受付されます。
管理画面の「全ファイル重複チェック」または毎日6:30・22:00の自動確認後、
ユニークURLだけが継続箱、収益、コピー対象へ反映されます。
