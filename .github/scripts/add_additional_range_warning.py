from pathlib import Path
import re

p=Path('home-layout-edit.html')
s=p.read_text()
old="""      const additionalIds=priority.filter(id=>serverLosers.has(id));
      workRows=additionalIds.slice(start-1,end).map(id=>({id,row:byPackage.get(id)})).filter(item=>item.row);
      if(!workRows.length)throw new Error('サーバーの当落表に、指定した追加ページ範囲の外れアカウントがありません。');

      // 追加ページ生成時のアイコンは title がキャンペーン名。
"""
new="""      const additionalIds=priority.filter(id=>serverLosers.has(id));
      const availableCount=additionalIds.length;
      if(start>availableCount)throw new Error(campaign+'の追加ページ対象は'+availableCount+'件です。指定開始 '+start+' は対象外です。');
      const effectiveEnd=Math.min(end,availableCount);
      workRows=additionalIds.slice(start-1,effectiveEnd).map(id=>({id,row:byPackage.get(id)})).filter(item=>item.row);
      if(!workRows.length)throw new Error('サーバーの当落表に、指定した追加ページ範囲の外れアカウントがありません。');
      if(end>availableCount){
        const ok=await showConfirm(
          '指定範囲より対象が少ないです',
          [
            campaign,
            '指定範囲：'+start+'～'+end,
            '実際の追加ページ対象：'+availableCount+'件',
            '今回の判定対象：'+start+'～'+effectiveEnd,
            (effectiveEnd+1)+'～'+end+'：'+campaign+'対象なし',
            '',
            '他キャンペーンの追加ページは判定しません。',
            'この範囲で続行しますか？'
          ].join('\\n')
        );
        if(!ok)throw new Error('追加ページの判定をキャンセルしました。');
      }

      // 追加ページ生成時のアイコンは title がキャンペーン名。
"""
if old not in s: raise SystemExit('additional range block not found')
s=s.replace(old,new,1)
p.write_text(s)

sw=Path('sw.js')
t=sw.read_text()
t=re.sub(r"const CACHE='[^']+';", "const CACHE='winning-url-manager-share-v36-additional-range-warning';", t, count=1)
sw.write_text(t)
