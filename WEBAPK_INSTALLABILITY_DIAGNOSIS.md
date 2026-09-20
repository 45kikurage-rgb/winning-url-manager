# CMF1 / Nothing系 WebAPKインストール不可の診断メモ

## 結論

実機画面の「インストール／このアプリはインストールできません」と灰色の `P` アイコンから、ChromeはこのページをWebAPKではなく `SHORTCUT` と判定しています。これは共有先登録より前のinstallability判定で止まっている状態です。

ただし、画像だけでは次のどれが直接原因かまでは確定できません。

- 端末Chromeがmanifestまたはprimary iconを取得できなかった
- 古いmanifest・アイコン・installability結果を使った
- Android側の取得が12秒でタイムアウトした
- manifest解析またはinstallabilityチェックに別のエラーが出た

公開中のPR #13ではmanifest、Service Worker、192/512pxアイコンを現在はHTTP 200で取得できます。したがって「サーバー上に今あるファイルが404」という説明だけでは、今回の実機表示を説明できません。端末が判定時に何を取得したかを切り分ける必要があります。

## この修正版で変えたこと

1. `/pwa-diagnostic/` に、`share_target`を一切含まない最小PWAを追加しました。
2. 診断ページは、Service Worker登録状態と`beforeinstallprompt`受信結果を画面に表示します。
3. 本体の`share_target.action`を、Cloudflare Pagesのcanonical URLである`/share`へ統一しました。
4. Service Workerは新しい`/share`と旧`/share.html`の両方のPOSTを受け取ります。
5. 本体Service Workerが、同一オリジンにある診断PWAなどの別キャッシュを消さないようにしました。
6. manifest、Service Worker、関連HTMLの版を`20260920-share-v4`へ統一しました。

## 変えていないもの

- `id: "./"` は変更していません。変更すると別PWAとして扱われる危険があるためです。
- `accept`の`*/*`は残しています。Chromiumのmanifest parserでは有効な指定で、Novaが実際に送るMIMEを採取する前に削る根拠がないためです。
- 当選管理、Novaバックアップ解析、サーバーAPIの業務ロジックは変更していません。

## 配備後の最短テスト

最初はChromeのサイトデータを削除しないでください。保存済みトークンまで消えるためです。

1. CMF1のChromeで `https://winning-url-manager.pages.dev/pwa-diagnostic/` を開きます。
2. 10秒ほど待ちます。
3. 画面が「Chrome判定：インストール可能」になるか確認します。
4. Chromeメニューの「ホーム画面に追加」も開きます。
5. 診断PWAの結果と本体トップページの結果を撮影します。

### 診断PWAだけインストール可能

端末のWebAPK機能は動いています。本体manifest、アイコン取得、または`share_target`を含む判定経路に原因を絞れます。

### 診断PWAもインストール不可

本体固有の`share_target`より、端末Chromeのキャッシュ、ネットワーク、WebAPKサービス、取得タイムアウトを優先して調査します。

## 直接エラーコードを取る方法

正確な原因を確定するには、Android ChromeをPCからリモート検査します。

1. Androidの開発者向けオプションでUSBデバッグを有効にします。
2. USBでPCへ接続し、Android側の接続許可を承認します。
3. PC版Chromeで `chrome://inspect/#devices` を開きます。
4. CMF1で本体ページを開き、PC側の対象タブで `inspect` を押します。
5. `Application` → `Manifest` のErrors / Installabilityと、`Console`のエラーを保存します。

このエラーが取れるまでは、manifestのID変更やMIME指定の削除を推測で行わないでください。

## 公式実装上の根拠

- `PwaUniversalInstallBottomSheetCoordinator`は、取得したAppTypeがWebAPK系でなければインストール不可として扱います。
- `AddToHomescreenDataFetcher`は、タイムアウト、primary icon取得失敗、installabilityエラー、WebAPK非互換URLなどでSHORTCUTへフォールバックします。
- `WebappsIconUtils`は、アイコンbitmapが無いか小さすぎる場合、URL由来の1文字を灰色背景に置いた代替アイコンを生成します。実機の灰色`P`と一致する挙動です。

参照:

- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/webapps/browser/android/java/src/org/chromium/components/webapps/pwa_universal_install/PwaUniversalInstallBottomSheetCoordinator.java
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/webapps/browser/android/add_to_homescreen_data_fetcher.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/webapps/browser/android/webapps_icon_utils.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/webapps/browser/installable/installable_evaluator.cc
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/manifest/manifest_parser.cc

## テスト結果

- PWA・共有関連テスト: 33件すべて成功
- 全体テスト: 96件中88件成功、8件失敗
- 8件はPR #13の時点から存在する、今回のPWA修正とは別領域の既知失敗です。
