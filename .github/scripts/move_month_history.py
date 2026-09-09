from pathlib import Path

p = Path('home-layout-admin.html')
s = p.read_text()

s = s.replace(
    '#accounts.panel h2{margin:0 0 6px;font-size:17px}.monthHistory{margin-top:16px;padding-top:10px;border-top:2px solid #fff}.monthHistory h3{margin:0 0 8px;font-size:16px}.historyTable{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}.historyTable th,.historyTable td{height:30px;padding:3px 2px;border:1px solid #777;text-align:center;white-space:nowrap}.historyTable th{font-size:11px;color:#ddd}',
    '#accounts.panel h2{margin:0 0 6px;font-size:17px}.accountHistoryActions{display:flex;justify-content:flex-end;margin-top:7px}.accountHistoryActions a{width:34%;min-height:38px;border:2px solid #fff;background:#000;color:#fff;display:grid;place-items:center;text-decoration:none;font-size:12px}'
)

s = s.replace(
    '<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div><div id="monthlyHistory" class="monthHistory"><h3>月別履歴</h3><div id="monthlyHistoryList"></div></div></section>',
    '<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div><div class="accountHistoryActions"><a href="./home-layout-monthly-history.html">月別履歴</a></div></section>'
)

marker1 = "  const historyRows=monthKeys.map(key=>"
marker2 = "  $('monthlyHistoryList').innerHTML="
if marker1 in s and marker2 in s:
    start = s.index(marker1)
    line_start = s.index(marker2, start)
    end = s.index('\n', line_start)
    s = s[:start] + s[end+1:]

p.write_text(s)

sw = Path('sw.js')
t = sw.read_text()
t = t.replace('winning-url-manager-share-v31-admin-fixed-header-history', 'winning-url-manager-share-v32-month-history-page')
if "'./home-layout-monthly-history.html'" not in t:
    t = t.replace("'./home-layout-admin.html'", "'./home-layout-admin.html','./home-layout-monthly-history.html'")
sw.write_text(t)
