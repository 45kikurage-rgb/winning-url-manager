# 段階1 配置安全性（2026-09-26）

APIの同名ブランチと組で使用する。詳細な導入／復旧手順はAPI側 `STAGE1_LAYOUT_SAFETY.md` を参照。

- 通常解析からaccounts/syncを除去。APIの現在正本と端末内固定配置の集合・座標・LINE番号を比較し、不一致なら生成しない。
- baselineだけに残る旧世代を現在対象へ復活させない。Core本体は変更せず、既知の退役LINEだけを入力から分離する。
- 初期配置の更新はサーバー正本との差分preview・確認後、NOVAと同一要求をIndexedDBへ保存してからD1確定する。
- D1成功後の応答喪失／端末内設定保存失敗は、保存操作IDを照会して復旧する。
- 生成物は確定前保存。確定不明・拒否のファイルを消さず保持する。新規生成物のhash不一致は確定再送を停止する。
- ダウンロード開始を復元完了と見なす自動削除を停止。明示作業完了でもpending／rejectedを削除しない。
- 管理画面の手動当落訂正も現在対象・開催中campaign・preview・revisionで保護する。
- `layout-safety.js` を配布allowlistとService Workerへ追加し、cacheを更新する。

## 検証

配置・復旧・ページフラグ・Service Worker関連91件成功。
全体108件中100成功・8失敗。失敗は変更前からのlist-data-rules（2）、revenue-deduction（4）、special-card-bulk-copy（2）。対象外実装は変更していない。
HTML内scriptと変更JSの構文検査、git diff --check成功。
ローカルのPages buildは既存フォント資産が取得されておらずENOENTで完了できなかった。フォントや画像を置き換える修正はしていない。GitHubの元treeにある既存資産は保持する。

旧クライアント書込みはAPI切替後426となる。API→Managerの順で切替し、端末を再読込して組合せを揃える。
本番環境・実Nova復元の受入は別途必要。段階2（MarkerCore統一）、180件、BASE、padding、ARUNOMATICは未実装。
