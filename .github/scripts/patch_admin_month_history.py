from pathlib import Path

p=Path('home-layout-admin.html')
s=p.read_text()

s=s.replace('.wrap{width:min(760px,100%);margin:auto;padding:10px 10px 0;overflow-x:hidden}', '.wrap{width:min(760px,100%);margin:auto;padding:72px 10px 0;overflow-x:hidden}')
s=s.replace('.top{display:grid;grid-template-columns:76px 1fr;gap:8px;margin-bottom:12px}', '.top{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:110;width:min(740px,calc(100% - 20px));display:grid;grid-template-columns:76px 1fr;gap:8px;margin:0;background:#000}')
s=s.replace('.accountSummary th,.accountSummary td{height:34px;padding:4px 2px;', '.accountSummary th,.accountSummary td{height:27px;padding:2px 2px;')
s=s.replace('.accountSummary tr.total td{font-size:15px;', '.accountSummary tr.total td{font-size:14px;')
s=s.replace("@media(max-width:390px){.panel{padding:10px}.table{font-size:10px}.menu button{font-size:10px}.accountSummary{font-size:13px}.accountSummary th{font-size:11px}.accountSummary th,.accountSummary td{height:32px;padding:3px 1px}}", "@media(max-width:390px){.panel{padding:8px}.table{font-size:10px}.menu button{font-size:10px}.accountSummary{font-size:12px}.accountSummary th{font-size:10px}.accountSummary th,.accountSummary td{height:25px;padding:1px}.top{top:8px}.wrap{padding-top:68px}}")
s=s.replace('.diffZero{color:#fff}', '.diffZero{color:#fff}#accounts.panel{padding:8px 12px}#accounts.panel h2{margin:0 0 6px;font-size:17px}.monthHistory{margin-top:16px;padding-top:10px;border-top:2px solid #fff}.monthHistory h3{margin:0 0 8px;font-size:16px}.historyTable{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px}.historyTable th,.historyTable td{height:30px;padding:3px 2px;border:1px solid #777;text-align:center;white-space:nowrap}.historyTable th{font-size:11px;color:#ddd}')
s=s.replace('<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div></section>', '<section id="accounts" class="panel cut show"><h2>端末/垢数</h2><div id="accountList"></div><div id="monthlyHistory" class="monthHistory"><h3>月別履歴</h3><div id="monthlyHistoryList"></div></div></section>')

start=s.index('  const now=new Date(),prevDate=')
end=s.index("  $('historyList').innerHTML=", start)
new="""  const now=new Date(),currentYear=now.getFullYear(),currentMonth=now.getMonth()+1;
  const parseMonth=value=>{const text=String(value??'').trim();let m=text.match(/^(\\d{4})[-\\/](\\d{1,2})/);if(!m)m=text.match(/^(\\d{4})年(\\d{1,2})月/);if(!m&&/^\\d{6}$/.test(text))m=[text,text.slice(0,4),text.slice(4,6)];return m?{y:Number(m[1]),m:Number(m[2])}:null};
  const monthKey=(y,m)=>`${y}.${String(m).padStart(2,'0')}`;
  const previousMonth=(y,m)=>m===1?{y:y-1,m:12}:{y,m:m-1};
  const currentKey=monthKey(currentYear,currentMonth),prev=previousMonth(currentYear,currentMonth),prevKey=monthKey(prev.y,prev.m);
  const monthTotals=new Map();
  const monthDeviceRows=new Map();
  data.capacity.forEach(row=>{const p=parseMonth(row.month);if(!p)return;const key=monthKey(p.y,p.m);monthTotals.set(key,(monthTotals.get(key)||0)+Number(row.account_count||0));if(!monthDeviceRows.has(key))monthDeviceRows.set(key,[]);monthDeviceRows.get(key).push(row)});
  const deviceIds=Array.from({length:15},(_,i)=>String(i+1).padStart(2,'0'));
  const diffText=n=>n===0?'±0':(n>0?`+${n}`:`${n}`),diffClass=n=>n>0?'diffPlus':n<0?'diffMinus':'diffZero';
  let totalNow=0;deviceIds.forEach(id=>totalNow+=currentByDevice.get(id)||0);
  const prevRows=monthDeviceRows.get(prevKey)||[];
  const hasPrevious=prevRows.length>0;
  const prevByDevice=new Map();
  if(hasPrevious){prevRows.forEach(row=>prevByDevice.set(deviceKey(row.device_id),Number(row.account_count||0)))}else{deviceIds.forEach(id=>prevByDevice.set(id,currentByDevice.get(id)||0))}
  const totalPrev=hasPrevious?(monthTotals.get(prevKey)||0):totalNow;
  const summaryRows=deviceIds.map(id=>{const current=currentByDevice.get(id)||0,previous=prevByDevice.get(id)||0,diff=current-previous;return `<tr><td>${id}</td><td>${current}</td><td>${previous}</td><td class="${diffClass(diff)}">${diffText(diff)}</td></tr>`}).join('');
  $('accountList').innerHTML=`<table class="accountSummary"><tr><th>端末</th><th>LINE数</th><th>前月末</th><th>前月比</th></tr>${summaryRows}<tr class="total"><td>合計</td><td>${totalNow}</td><td>${totalPrev}</td><td class="${diffClass(totalNow-totalPrev)}">${diffText(totalNow-totalPrev)}</td></tr></table>`;
  monthTotals.set(currentKey,totalNow);
  const monthKeys=[...monthTotals.keys()].sort((a,b)=>{const [ay,am]=a.split('.').map(Number),[by,bm]=b.split('.').map(Number);return (by*12+bm)-(ay*12+am)});
  const historyRows=monthKeys.map(key=>{const [y,m]=key.split('.').map(Number),pm=previousMonth(y,m),pk=monthKey(pm.y,pm.m),count=monthTotals.get(key)||0,previous=monthTotals.has(pk)?monthTotals.get(pk):count,diff=count-previous;return `<tr><td>${key}</td><td>${count}</td><td class="${diffClass(diff)}">${diffText(diff)}</td></tr>`}).join('');
  $('monthlyHistoryList').innerHTML=`<table class="historyTable"><tr><th>年月</th><th>垢数</th><th>前月比</th></tr>${historyRows}</table>`;
"""
s=s[:start]+new+s[end:]
p.write_text(s)

sw=Path('sw.js')
t=sw.read_text().replace('winning-url-manager-share-v30-admin-device-summary','winning-url-manager-share-v31-admin-fixed-header-history')
sw.write_text(t)
