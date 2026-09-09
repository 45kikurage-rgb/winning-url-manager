from pathlib import Path

p=Path('home-layout-admin.html')
s=p.read_text()

s=s.replace('.accountSummary th,.accountSummary td{height:27px;padding:2px 2px;', '.accountSummary th,.accountSummary td{height:29px;padding:2px 2px;')
s=s.replace('#accounts.panel{padding:8px 12px}#accounts.panel h2{margin:0 0 6px;font-size:17px}.accountHistoryActions{display:flex;justify-content:flex-end;margin-top:7px}.accountHistoryActions a{width:34%;min-height:38px;', '#accounts.panel{padding:8px 12px}#accounts.panel h2{margin:0 0 6px;font-size:17px}.accountHistoryActions{display:grid;grid-template-columns:1fr 34%;gap:8px;align-items:center;margin-top:7px}.accountHistoryStatus{min-height:38px;display:flex;align-items:center;color:#ffd43b;font-size:12px}.accountHistoryActions a{width:100%;min-height:38px;')
s=s.replace('@media(max-width:390px){.panel{padding:8px}.table{font-size:10px}.menu button{font-size:10px}.accountSummary{font-size:12px}.accountSummary th{font-size:10px}.accountSummary th,.accountSummary td{height:25px;padding:1px}', '@media(max-width:390px){.panel{padding:8px}.table{font-size:10px}.menu button{font-size:10px}.accountSummary{font-size:12px}.accountSummary th{font-size:10px}.accountSummary th,.accountSummary td{height:27px;padding:1px}')
s=s.replace('<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div><div class="accountHistoryActions"><a href="./home-layout-monthly-history.html">月別履歴</a></div></section>', '<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div><div class="accountHistoryActions"><div id="accountSyncStatus" class="accountHistoryStatus"></div><a href="./home-layout-monthly-history.html">月別履歴</a></div></section>')
s=s.replace('<div id="status" class="status" aria-live="polite"></div>', '<div id="status" class="status" aria-live="polite" style="display:none"></div>')
s=s.replace("const status=text=>$('status').textContent=text;", "const status=text=>{const el=$('status');if(el)el.textContent=text;const accountStatus=$('accountSyncStatus');if(accountStatus)accountStatus.textContent=text;};")
p.write_text(s)

sw=Path('sw.js')
t=sw.read_text().replace('winning-url-manager-share-v32-month-history-page','winning-url-manager-share-v33-admin-inline-sync-status')
sw.write_text(t)
