from pathlib import Path

p=Path('home-layout-edit.html')
s=p.read_text()
old="""    }else{\n      const seen=new Set();\n      const additional=afterRows.filter(row=>Number(row.container)===-100&&Number(row.itemType)===0&&Number(row.screen)>maxScreen&&isLine(row))\n        .sort((a,b)=>Number(a.screen)-Number(b.screen)||Number(a.cellY)-Number(b.cellY)||Number(a.cellX)-Number(b.cellX)||Number(a._id)-Number(b._id))\n        .filter(row=>{const id=packageId(row.intent);if(!id||seen.has(id))return false;seen.add(id);return true});\n      workRows=additional.slice(start-1,end).map(row=>({id:packageId(row.intent),row:byPackage.get(packageId(row.intent))})).filter(item=>item.row);\n    }\n"""
new="""    }else{\n      // 追加ページは、抽選後に7段目へ移動したLINEが画面上から抜けるため、\n      // 現在の画面配置だけで1番目〜N番目を数えると順番がずれる。\n      // 前回生成時に保存したキャンペーンログの packages 順を正として復元する。\n      const logsBefore=deviceLogs($('device').value);\n      const loggedOrder=[];\n      const loggedSeen=new Set();\n      for(const name of logsBefore.order||[]){\n        for(const id of logsBefore.campaigns?.[name]?.packages||[]){\n          if(!id||loggedSeen.has(id)||!byPackage.has(id))continue;\n          loggedSeen.add(id);\n          loggedOrder.push(id);\n        }\n      }\n      let additionalIds=loggedOrder;\n      if(!additionalIds.length){\n        // 古いデータなどログがない場合のみ、従来の画面配置から復元する。\n        // 7段目へ移動済みのLINEも候補へ加え、同一IDは除外する。\n        const seen=new Set();\n        const visible=afterRows.filter(row=>Number(row.container)===-100&&Number(row.itemType)===0&&Number(row.screen)>maxScreen&&isLine(row))\n          .sort((a,b)=>Number(a.screen)-Number(b.screen)||Number(a.cellY)-Number(b.cellY)||Number(a.cellX)-Number(b.cellX)||Number(a._id)-Number(b._id))\n          .map(row=>packageId(row.intent)).filter(Boolean);\n        additionalIds=[...visible,...row7Packages].filter(id=>{if(seen.has(id)||!byPackage.has(id))return false;seen.add(id);return true});\n      }\n      workRows=additionalIds.slice(start-1,end).map(id=>({id,row:byPackage.get(id)})).filter(item=>item.row);\n    }\n"""
if old not in s:
    raise SystemExit('target block not found')
s=s.replace(old,new,1)
old_summary="""      ['抽選した範囲',workRows.length+'件'],\n      ['初期にないID',missing.length+'件']\n"""
new_summary="""      ['抽選した範囲',workRows.length+'件'],\n      ['対象LINE',workRows.map(item=>item.row?.lineNumber).filter(Number.isFinite).join('・')||'--'],\n      ['初期にないID',missing.length+'件']\n"""
if old_summary not in s:
    raise SystemExit('summary block not found')
s=s.replace(old_summary,new_summary,1)
p.write_text(s)

sw=Path('sw.js')
t=sw.read_text()
import re
t=re.sub(r"const CACHE='[^']+';", "const CACHE='winning-url-manager-share-v34-fix-additional-range';", t, count=1)
sw.write_text(t)
