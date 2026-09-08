(function(global){
  'use strict';

  const textDecoder=new TextDecoder('utf-8');

  function u16(v,o){return v.getUint16(o,true)}
  function u32(v,o){return v.getUint32(o,true)}
  function be16(v,o){return v.getUint16(o,false)}
  function be32(v,o){return v.getUint32(o,false)}

  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined')throw new Error('このブラウザはZIP展開に対応していません。Chromeを最新版にしてください。');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extractZipEntry(arrayBuffer,targetName){
    const bytes=new Uint8Array(arrayBuffer);
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1;
    for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++){
      if(u32(view,i)===0x06054b50)eocd=i;
    }
    if(eocd<0)throw new Error('NovaバックアップのZIP情報を確認できません。');
    const count=u16(view,eocd+10);
    let offset=u32(view,eocd+16);
    for(let n=0;n<count;n++){
      if(offset+46>bytes.length||u32(view,offset)!==0x02014b50)throw new Error('ZIPのファイル一覧が破損しています。');
      const method=u16(view,offset+10);
      const compressedSize=u32(view,offset+20);
      const originalSize=u32(view,offset+24);
      const nameLength=u16(view,offset+28);
      const extraLength=u16(view,offset+30);
      const commentLength=u16(view,offset+32);
      const localOffset=u32(view,offset+42);
      const name=textDecoder.decode(bytes.subarray(offset+46,offset+46+nameLength));
      if(name===targetName){
        if(localOffset+30>bytes.length||u32(view,localOffset)!==0x04034b50)throw new Error('nova.dbの格納位置を確認できません。');
        const localNameLength=u16(view,localOffset+26);
        const localExtraLength=u16(view,localOffset+28);
        const start=localOffset+30+localNameLength+localExtraLength;
        const end=start+compressedSize;
        if(end>bytes.length)throw new Error('nova.dbのデータが途中で切れています。');
        const compressed=bytes.subarray(start,end);
        let result;
        if(method===0)result=compressed.slice();
        else if(method===8)result=await inflateRaw(compressed);
        else throw new Error('未対応のZIP圧縮方式です。');
        if(originalSize&&result.length!==originalSize)throw new Error('nova.dbの展開サイズが一致しません。');
        return result;
      }
      offset+=46+nameLength+extraLength+commentLength;
    }
    throw new Error('バックアップ内にnova.dbがありません。');
  }

  function readVarint(bytes,start){
    let value=0n;
    for(let i=0;i<9;i++){
      if(start+i>=bytes.length)throw new Error('SQLite可変長整数が途中で切れています。');
      const b=bytes[start+i];
      if(i===8)return {value:Number((value<<8n)|BigInt(b)),length:9};
      value=(value<<7n)|BigInt(b&0x7f);
      if(!(b&0x80))return {value:Number(value),length:i+1};
    }
    throw new Error('SQLite可変長整数を読み取れません。');
  }

  function signedBigEndian(bytes,start,length){
    let value=0n;
    for(let i=0;i<length;i++)value=(value<<8n)|BigInt(bytes[start+i]);
    const bits=BigInt(length*8);
    if(value&(1n<<(bits-1n)))value-=1n<<bits;
    const num=Number(value);
    return Number.isSafeInteger(num)?num:value.toString();
  }

  function decodeText(bytes,encoding){
    if(encoding===1)return new TextDecoder('utf-8').decode(bytes);
    if(encoding===2)return new TextDecoder('utf-16le').decode(bytes);
    if(encoding===3){
      const swapped=new Uint8Array(bytes.length);
      for(let i=0;i<bytes.length;i+=2){swapped[i]=bytes[i+1]||0;swapped[i+1]=bytes[i]||0}
      return new TextDecoder('utf-16le').decode(swapped);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function serialLength(type){
    if(type===0||type===8||type===9||type===10||type===11)return 0;
    if(type===1)return 1;if(type===2)return 2;if(type===3)return 3;if(type===4)return 4;
    if(type===5)return 6;if(type===6||type===7)return 8;
    return type>=12?Math.floor((type-(type%2===0?12:13))/2):0;
  }

  function decodeRecord(payload,encoding){
    const header=readVarint(payload,0);
    const headerSize=header.value;
    let h=header.length;
    const types=[];
    while(h<headerSize){const v=readVarint(payload,h);types.push(v.value);h+=v.length}
    let p=headerSize;
    return types.map(type=>{
      const len=serialLength(type);
      if(p+len>payload.length)throw new Error('SQLiteレコードが途中で切れています。');
      let value=null;
      if(type===0)value=null;
      else if(type>=1&&type<=6)value=signedBigEndian(payload,p,len);
      else if(type===7)value=new DataView(payload.buffer,payload.byteOffset+p,8).getFloat64(0,false);
      else if(type===8)value=0;
      else if(type===9)value=1;
      else if(type>=12&&type%2===0)value=payload.slice(p,p+len);
      else if(type>=13)value=decodeText(payload.subarray(p,p+len),encoding);
      p+=len;
      return value;
    });
  }

  function createSqliteReader(bytes){
    if(textDecoder.decode(bytes.subarray(0,16))!=='SQLite format 3\u0000')throw new Error('nova.dbがSQLite形式ではありません。');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let pageSize=be16(view,16);if(pageSize===1)pageSize=65536;
    const reserved=bytes[20]||0;
    const usable=pageSize-reserved;
    const encoding=be32(view,56)||1;
    const pageCount=Math.floor(bytes.length/pageSize);

    function pageOffset(pageNo){
      if(!Number.isInteger(pageNo)||pageNo<1||pageNo>pageCount)throw new Error(`SQLiteページ番号が不正です: ${pageNo}`);
      return (pageNo-1)*pageSize;
    }

    function cellPayload(cellOffset,payloadSize,prefixLength){
      const maxLocal=usable-35;
      const minLocal=Math.floor((usable-12)*32/255)-23;
      let local=payloadSize;
      if(payloadSize>maxLocal){
        local=minLocal+((payloadSize-minLocal)%(usable-4));
        if(local>maxLocal)local=minLocal;
      }
      const out=new Uint8Array(payloadSize);
      out.set(bytes.subarray(cellOffset+prefixLength,cellOffset+prefixLength+local),0);
      let written=local;
      if(written<payloadSize){
        let overflow=be32(view,cellOffset+prefixLength+local);
        const seen=new Set();
        while(written<payloadSize){
          if(seen.has(overflow))throw new Error('SQLiteオーバーフローページが循環しています。');
          seen.add(overflow);
          const off=pageOffset(overflow);
          const next=be32(view,off);
          const take=Math.min(usable-4,payloadSize-written);
          out.set(bytes.subarray(off+4,off+4+take),written);
          written+=take;overflow=next;
          if(written<payloadSize&&!overflow)throw new Error('SQLiteオーバーフローデータが不足しています。');
        }
      }
      return out;
    }

    function rowsFromTable(rootPage){
      const rows=[];const visited=new Set();
      function walk(pageNo){
        if(visited.has(pageNo))return;visited.add(pageNo);
        const base=pageOffset(pageNo);
        const header=base+(pageNo===1?100:0);
        const type=bytes[header];
        const count=be16(view,header+3);
        if(type===0x05){
          for(let i=0;i<count;i++){
            const ptr=be16(view,header+12+i*2);
            walk(be32(view,base+ptr));
          }
          walk(be32(view,header+8));
          return;
        }
        if(type!==0x0d)throw new Error(`未対応のSQLiteテーブルページです: ${type}`);
        for(let i=0;i<count;i++){
          const ptr=be16(view,header+8+i*2);
          const cell=base+ptr;
          const payloadVar=readVarint(bytes,cell);
          const rowidVar=readVarint(bytes,cell+payloadVar.length);
          const prefix=payloadVar.length+rowidVar.length;
          const payload=cellPayload(cell,payloadVar.value,prefix);
          rows.push({rowid:rowidVar.value,values:decodeRecord(payload,encoding)});
        }
      }
      walk(rootPage);return rows;
    }

    const master=rowsFromTable(1);
    const favoriteTable=master.find(row=>row.values[0]==='table'&&row.values[1]==='favorites');
    if(!favoriteTable)throw new Error('favoritesテーブルがありません。');
    return {rowsFromTable,favoritesRoot:Number(favoriteTable.values[3]),pageSize,pageCount};
  }

  function extractComponent(intent){
    const match=String(intent||'').match(/(?:^|;)component=([^;]+)/);
    if(!match)return null;
    const component=match[1];
    return {component,packageName:component.split('/')[0]};
  }

  async function parseNovaBackup(file){
    if(!file)throw new Error('バックアップファイルがありません。');
    const lower=String(file.name||'').toLowerCase();
    if(lower&&!lower.endsWith('.novabackup'))throw new Error('.novabackupファイルを選択してください。');
    const db=await extractZipEntry(await file.arrayBuffer(),'nova.db');
    const sqlite=createSqliteReader(db);
    const rows=sqlite.rowsFromTable(sqlite.favoritesRoot);
    const columns=['_id','title','intent','container','screen','cellX','cellY','spanX','spanY','itemType','appWidgetId','iconPackage','iconResource','icon','appWidgetProvider','modified','restored','profileId','rank','options','appWidgetSource','customIconSource','customIconLoadedState','flingUpIntent','flingDownIntent','zOrder','novaFlags'];
    const index=Object.fromEntries(columns.map((name,i)=>[name,i]));
    const apps=[];const outOfRange=[];
    for(const row of rows){
      const v=row.values;
      const component=extractComponent(v[index.intent]);
      if(Number(v[index.container])!==-100||Number(v[index.itemType])!==0||!component)continue;
      const title=String(v[index.title]||'');
      if(!component.packageName.startsWith('jp.naver.line.'))continue;
      const screen=Math.trunc(Number(v[index.screen]));
      const x=Math.trunc(Number(v[index.cellX]));
      const y=Math.trunc(Number(v[index.cellY]));
      const page=screen+1;
      const position=y*5+x+1;
      const slot=(page-1)*30+position;
      const item={rowId:Number(v[index._id]??row.rowid),title,appId:component.packageName,component:component.component,screen,page,x,y,position,slot};
      if(page>=1&&page<=5&&x>=0&&x<5&&y>=0&&y<6)apps.push(item);else outOfRange.push(item);
    }
    apps.sort((a,b)=>a.slot-b.slot||a.appId.localeCompare(b.appId));
    return {fileName:file.name||'',fileSize:file.size||0,dbSize:db.length,pageSize:sqlite.pageSize,pageCount:sqlite.pageCount,totalFavoriteRows:rows.length,lineApps:apps,outOfRange};
  }

  function compareDevices(devices){
    const rows=[];
    for(let slot=1;slot<=150;slot++){
      const eligible=devices.filter(device=>Number(device.maxAccounts||150)>=slot);
      const counts=new Map();
      const perDevice=[];
      for(const device of eligible){
        const matches=(device.analysis?.lineApps||[]).filter(app=>app.slot===slot);
        if(matches.length===0){counts.set('(未配置)',(counts.get('(未配置)')||0)+1);perDevice.push({deviceId:device.id,deviceName:device.deviceName||'端末名未設定',appId:'(未配置)'});continue}
        const ids=[...new Set(matches.map(app=>app.appId))];
        const id=ids.length===1?ids[0]:`(重複配置) ${ids.join(' / ')}`;
        counts.set(id,(counts.get(id)||0)+1);perDevice.push({deviceId:device.id,deviceName:device.deviceName||'端末名未設定',appId:id});
      }
      const variants=[...counts].map(([appId,count])=>({appId,count})).sort((a,b)=>b.count-a.count||a.appId.localeCompare(b.appId));
      const match=eligible.length>0&&variants.length===1&&variants[0].appId!=='(未配置)'&&!variants[0].appId.startsWith('(重複配置)')&&variants[0].count===eligible.length;
      rows.push({slot,page:Math.floor((slot-1)/30)+1,position:(slot-1)%30+1,eligibleCount:eligible.length,variants,perDevice,match});
    }
    return rows;
  }

  global.NovaTools={parseNovaBackup,compareDevices};
})(typeof window!=='undefined'?window:globalThis);
