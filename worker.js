// winning-url-api
export default {
  async fetch(request, env) {
    const DB = env.DB;
    const reqUrl = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });

    const ensureCheckpointTable = () => DB.prepare(`
      CREATE TABLE IF NOT EXISTS csv_checkpoints (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        url_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(list_id, url_count)
      )
    `).run();

    const ensureCsvStatusTable = async () => {
      await ensureCheckpointTable();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS submission_csv_status (
          submission_id TEXT PRIMARY KEY,
          export_count INTEGER NOT NULL DEFAULT 0,
          last_exported_at TEXT
        )
      `).run();
      // 旧CSV CHECKPOINTは初回だけURL単位の抽出状態へ引き継ぐ。
      await DB.prepare(`
        INSERT OR IGNORE INTO submission_csv_status
        (submission_id,export_count,last_exported_at)
        SELECT ranked.id,
               CASE WHEN ranked.row_no<=ranked.checkpoint_count THEN 1 ELSE 0 END,
               CASE WHEN ranked.row_no<=ranked.checkpoint_count THEN ranked.checkpoint_at ELSE NULL END
        FROM (
          SELECT s.id,
                 ROW_NUMBER() OVER (PARTITION BY s.list_id ORDER BY s.rowid ASC) AS row_no,
                 COALESCE(cp.checkpoint_count,0) AS checkpoint_count,
                 cp.checkpoint_at
          FROM submissions s
          LEFT JOIN (
            SELECT list_id,MAX(url_count) AS checkpoint_count,MAX(created_at) AS checkpoint_at
            FROM csv_checkpoints
            GROUP BY list_id
          ) cp ON cp.list_id=s.list_id
        ) ranked
      `).run();
    };

    const ensureProcessingTables = async () => {
      await ensureCsvStatusTable();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS submission_processing_status (
          submission_id TEXT PRIMARY KEY,
          process_count INTEGER NOT NULL DEFAULT 0,
          processed_at TEXT,
          processed_method TEXT,
          last_batch_id TEXT
        )
      `).run();
      // 既存のCSV抽出状態を、COPY/CSV共通の処理状態へ引き継ぐ。
      await DB.prepare(`
        INSERT OR IGNORE INTO submission_processing_status
        (submission_id,process_count,processed_at,processed_method,last_batch_id)
        SELECT s.id,
               COALESCE(cs.export_count,0),
               cs.last_exported_at,
               CASE WHEN COALESCE(cs.export_count,0)>0 THEN 'csv' ELSE NULL END,
               NULL
        FROM submissions s
        LEFT JOIN submission_csv_status cs ON cs.submission_id=s.id
      `).run();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS copy_batches (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          undone_at TEXT,
          cancelled_at TEXT
        )
      `).run();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS copy_batch_items (
          batch_id TEXT NOT NULL,
          submission_id TEXT NOT NULL,
          PRIMARY KEY(batch_id,submission_id)
        )
      `).run();
    };

    const ensureSubmissionChangeLogTable = () => DB.prepare(`
      CREATE TABLE IF NOT EXISTS submission_change_log (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        action TEXT NOT NULL,
        old_list_id TEXT,
        new_list_id TEXT,
        old_url TEXT,
        new_url TEXT,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const validHttpUrl = value => {
      try {
        const parsed = new URL(String(value || '').trim());
        return ['http:','https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    };

    const ensureListSettingsTable = async () => {
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS list_settings (
          list_id TEXT PRIMARY KEY,
          list_month TEXT NOT NULL,
          unit_price INTEGER NOT NULL DEFAULT 0
        )
      `).run();
      // 導入時に存在しているリストは、指定どおりすべて2026年8月分にする。
      await DB.prepare(`
        INSERT OR IGNORE INTO list_settings (list_id,list_month,unit_price)
        SELECT id,'2026-08',0 FROM lists
      `).run();
    };

    const ensureListActivityTable = async () => {
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS list_activity (
          list_id TEXT PRIMARY KEY,
          is_active INTEGER NOT NULL DEFAULT 1
        )
      `).run();
      // 導入時の既存リストと新規リストは、すべてActiveを初期値にする。
      await DB.prepare(`
        INSERT OR IGNORE INTO list_activity (list_id,is_active)
        SELECT id,1 FROM lists
      `).run();
    };

    const ensureListFolderTable = async () => {
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS list_folders (
          list_id TEXT PRIMARY KEY,
          folder_type TEXT NOT NULL DEFAULT 'month'
        )
      `).run();
      await DB.prepare(`
        INSERT OR IGNORE INTO list_folders (list_id,folder_type)
        SELECT id,'month' FROM lists
      `).run();
    };

    const ensureWalletStatusTable = async () => {
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS submission_wallet_status (
          submission_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'pending',
          completed_at TEXT
        )
      `).run();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS submission_wallet_verification (
          submission_id TEXT PRIMARY KEY,
          verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    };

    const currentJstMonth = () => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(x => [x.type,x.value]));
      return `${values.year}-${values.month}`;
    };

    const currentJstDateParts = () => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(x => [x.type,x.value]));
      return {month:`${values.year}-${values.month}`,day:Number(values.day),date:`${values.year}-${values.month}-${values.day}`};
    };

    const addMonth = (month,delta=1) => {
      const [year,mon] = month.split('-').map(Number);
      const d = new Date(Date.UTC(year,mon-1+delta,1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    };


    // システム導入前など、DBに存在しない月次収益の補正額。
    // 2026年8月は未反映分 956,000円を加算する。
    const REVENUE_ADJUSTMENTS = Object.freeze({
      '2026-08': 956000
    });
    const revenueAdjustmentFor = (month) => Number(REVENUE_ADJUSTMENTS[month] || 0);

    const ensureRevenueTable = async () => {
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS monthly_revenue_snapshots (
          month TEXT PRIMARY KEY,
          amount INTEGER NOT NULL,
          frozen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      await DB.prepare(`
        CREATE TABLE IF NOT EXISTS monthly_revenue_snapshot_details (
          month TEXT NOT NULL,
          list_id TEXT NOT NULL,
          list_name TEXT NOT NULL,
          url_count INTEGER NOT NULL,
          unit_price INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          PRIMARY KEY(month,list_id)
        )
      `).run();
    };

    const getDynamicRevenue = async () => {
      await ensureListSettingsTable();
      const result = await DB.prepare(`
        SELECT strftime('%Y-%m',datetime(s.created_at,'+9 hours')) AS month,
               COALESCE(SUM(ls.unit_price),0) AS amount
        FROM submissions s
        JOIN list_settings ls ON ls.list_id=s.list_id
        GROUP BY strftime('%Y-%m',datetime(s.created_at,'+9 hours'))
        ORDER BY month DESC
      `).all();
      return result.results || [];
    };

    const getDynamicRevenueDetails = async () => {
      await ensureListSettingsTable();
      const result = await DB.prepare(`
        SELECT strftime('%Y-%m',datetime(s.created_at,'+9 hours')) AS month,
               l.id AS list_id,l.name AS list_name,
               COUNT(s.id) AS url_count,ls.unit_price,
               COUNT(s.id)*ls.unit_price AS amount
        FROM submissions s
        JOIN lists l ON l.id=s.list_id
        JOIN list_settings ls ON ls.list_id=s.list_id
        GROUP BY strftime('%Y-%m',datetime(s.created_at,'+9 hours')),
                 l.id,l.name,ls.unit_price
        ORDER BY month DESC,l.name ASC
      `).all();
      return result.results || [];
    };

    const freezeEligibleRevenue = async () => {
      await ensureRevenueTable();
      const dynamicRows = await getDynamicRevenue();
      const dynamicDetails = await getDynamicRevenueDetails();
      const now = currentJstDateParts();
      for (const row of dynamicRows) {
        const freezeMonth = addMonth(row.month,1);
        const eligible = now.month > freezeMonth || (now.month === freezeMonth && now.day >= 6);
        if (eligible) {
          const adjustedAmount = Number(row.amount||0) + revenueAdjustmentFor(row.month);
          await DB.prepare(`
            INSERT OR IGNORE INTO monthly_revenue_snapshots (month,amount)
            VALUES (?,?)
          `).bind(row.month,adjustedAmount).run();
          for (const detail of dynamicDetails.filter(x => x.month === row.month)) {
            await DB.prepare(`
              INSERT OR IGNORE INTO monthly_revenue_snapshot_details
              (month,list_id,list_name,url_count,unit_price,amount)
              VALUES (?,?,?,?,?,?)
            `).bind(
              detail.month,detail.list_id,detail.list_name,
              Number(detail.url_count||0),Number(detail.unit_price||0),Number(detail.amount||0)
            ).run();
          }
          const adjustment = revenueAdjustmentFor(row.month);
          if (adjustment) {
            await DB.prepare(`
              INSERT OR IGNORE INTO monthly_revenue_snapshot_details
              (month,list_id,list_name,url_count,unit_price,amount)
              VALUES (?,?,?,?,?,?)
            `).bind(
              row.month,'__manual_adjustment__','システム導入前未反映分',0,0,adjustment
            ).run();
          }
        }
      }
      return dynamicRows;
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (reqUrl.pathname === "/" && request.method === "GET") {
        return json({ ok: true, service: "winning-url-api" });
      }

      if (reqUrl.pathname === "/api/lists" && request.method === "GET") {
        await ensureListSettingsTable();
        await ensureListActivityTable();
        await ensureListFolderTable();
        await ensureWalletStatusTable();
        await ensureProcessingTables();
        const result = await DB.prepare(`
          SELECT l.id,l.name,l.created_at,
                 ls.list_month,ls.unit_price,
                 lf.folder_type,
                 la.is_active,
                 COUNT(s.id) AS count,
                 SUM(CASE
                   WHEN s.id IS NOT NULL AND COALESCE(sps.process_count,0)=0 THEN 1
                   ELSE 0
                 END) AS unprocessed_count,
                 SUM(CASE
                   WHEN s.id IS NOT NULL AND COALESCE(sws.status,'pending')<>'completed' THEN 1
                   ELSE 0
                 END) AS wallet_unhandled_count,
                 SUM(CASE
                   WHEN s.id IS NOT NULL AND sws.status='completed' AND swv.submission_id IS NULL THEN 1
                   ELSE 0
                 END) AS wallet_recheck_count
          FROM lists l
          JOIN list_settings ls ON ls.list_id=l.id
          JOIN list_activity la ON la.list_id=l.id
          JOIN list_folders lf ON lf.list_id=l.id
          LEFT JOIN submissions s ON s.list_id=l.id
          LEFT JOIN submission_processing_status sps ON sps.submission_id=s.id
          LEFT JOIN submission_wallet_status sws ON sws.submission_id=s.id
          LEFT JOIN submission_wallet_verification swv ON swv.submission_id=s.id
          GROUP BY l.id,l.name,l.created_at,ls.list_month,ls.unit_price,lf.folder_type,la.is_active
          ORDER BY ls.list_month DESC,l.created_at DESC
        `).all();
        return json({ ok: true, lists: result.results || [] });
      }

      if (reqUrl.pathname === "/api/lists" && request.method === "POST") {
        const body = await request.json();
        const name = String(body.name || "").trim();
        if (!name) return json({ ok:false, error:"リスト名を入力してください" }, 400);

        const id = crypto.randomUUID();
        await DB.prepare(`INSERT INTO lists (id,name) VALUES (?,?)`).bind(id,name).run();
        await ensureListSettingsTable();
        await ensureListActivityTable();
        await ensureListFolderTable();
        await DB.prepare(`
          INSERT INTO list_settings (list_id,list_month,unit_price)
          VALUES (?,?,0)
          ON CONFLICT(list_id) DO UPDATE SET list_month=excluded.list_month
        `).bind(id,currentJstMonth()).run();
        await DB.prepare(`
          INSERT INTO list_folders (list_id,folder_type) VALUES (?,'month')
          ON CONFLICT(list_id) DO UPDATE SET folder_type='month'
        `).bind(id).run();

        const active = await DB.prepare(`
          SELECT value FROM meta WHERE key='active_list'
        `).first();

        if (!active) {
          await DB.prepare(`
            INSERT INTO meta (key,value) VALUES ('active_list',?)
          `).bind(id).run();
        }
        return json({ ok:true, id, name });
      }

      const activityMatch = reqUrl.pathname.match(/^\/api\/lists\/([^/]+)\/activity$/);
      if (activityMatch && request.method === "POST") {
        const listId = decodeURIComponent(activityMatch[1]);
        const body = await request.json();
        if (typeof body.is_active !== 'boolean') {
          return json({ok:false,error:"Active状態が正しくありません"},400);
        }
        const exists = await DB.prepare(`SELECT id FROM lists WHERE id=?`).bind(listId).first();
        if (!exists) return json({ok:false,error:"リストがありません"},404);
        await ensureListActivityTable();
        await DB.prepare(`UPDATE list_activity SET is_active=? WHERE list_id=?`)
          .bind(body.is_active?1:0,listId).run();
        return json({ok:true,list_id:listId,is_active:body.is_active});
      }

      // リストごとの単価を保存（0円以上の整数）。
      const unitPriceMatch = reqUrl.pathname.match(/^\/api\/lists\/([^/]+)\/unit-price$/);
      if (unitPriceMatch && request.method === "POST") {
        const listId = decodeURIComponent(unitPriceMatch[1]);
        const body = await request.json();
        const unitPrice = Number(body.unit_price);
        if (!Number.isInteger(unitPrice) || unitPrice < 0 || unitPrice > 9999999) {
          return json({ok:false,error:"単価は0〜9,999,999円の整数で入力してください"},400);
        }
        const exists = await DB.prepare(`SELECT id FROM lists WHERE id=?`).bind(listId).first();
        if (!exists) return json({ok:false,error:"リストがありません"},404);
        // 6日を過ぎた前月分は、単価変更前の金額で先に固定する。
        await freezeEligibleRevenue();
        await ensureListSettingsTable();
        await DB.prepare(`UPDATE list_settings SET unit_price=? WHERE list_id=?`)
          .bind(unitPrice,listId).run();
        return json({ok:true,list_id:listId,unit_price:unitPrice});
      }

      // リスト名と収納フォルダー変更
      const renameMatch = reqUrl.pathname.match(/^\/api\/lists\/([^/]+)\/rename$/);
      if (renameMatch && request.method === "POST") {
        const listId = decodeURIComponent(renameMatch[1]);
        const body = await request.json();
        const name = String(body.name || "").trim();

        if (!name) return json({ ok:false, error:"リスト名を入力してください" }, 400);

        const exists = await DB.prepare(`
          SELECT id FROM lists WHERE id=?
        `).bind(listId).first();

        if (!exists) return json({ ok:false, error:"リストがありません" }, 404);

        await ensureListSettingsTable();
        await ensureListFolderTable();
        const currentSetting = await DB.prepare(`
          SELECT ls.list_month,lf.folder_type
          FROM list_settings ls JOIN list_folders lf ON lf.list_id=ls.list_id
          WHERE ls.list_id=?
        `).bind(listId).first();
        const folderType = ['month','permanent'].includes(body.folder_type)
          ? body.folder_type : String(currentSetting?.folder_type||'month');
        const listMonth = /^\d{4}-\d{2}$/.test(String(body.list_month||''))
          ? String(body.list_month) : String(currentSetting?.list_month||currentJstMonth());

        await DB.prepare(`
          UPDATE lists SET name=? WHERE id=?
        `).bind(name,listId).run();

        await DB.prepare(`UPDATE list_settings SET list_month=? WHERE list_id=?`)
          .bind(listMonth,listId).run();
        await DB.prepare(`
          INSERT INTO list_folders (list_id,folder_type) VALUES (?,?)
          ON CONFLICT(list_id) DO UPDATE SET folder_type=excluded.folder_type
        `).bind(listId,folderType).run();

        return json({ ok:true, id:listId, name, folder_type:folderType, list_month:listMonth });
      }

      if (reqUrl.pathname.startsWith("/api/lists/") && request.method === "DELETE") {
        const listId = decodeURIComponent(reqUrl.pathname.substring("/api/lists/".length));

        await ensureProcessingTables();
        await ensureListSettingsTable();
        await ensureListActivityTable();
        await ensureListFolderTable();
        await ensureWalletStatusTable();
        // 削除で過去の固定対象収益が失われないよう、先に確定する。
        await freezeEligibleRevenue();

        const active = await DB.prepare(`
          SELECT value FROM meta WHERE key='active_list'
        `).first();

        if (active?.value === listId) {
          await DB.prepare(`DELETE FROM meta WHERE key='active_list'`).run();
        }

        await DB.prepare(`
          DELETE FROM submission_csv_status
          WHERE submission_id IN (SELECT id FROM submissions WHERE list_id=?)
        `).bind(listId).run();
        await DB.prepare(`
          DELETE FROM submission_processing_status
          WHERE submission_id IN (SELECT id FROM submissions WHERE list_id=?)
        `).bind(listId).run();
        await DB.prepare(`
          DELETE FROM submission_wallet_status
          WHERE submission_id IN (SELECT id FROM submissions WHERE list_id=?)
        `).bind(listId).run();
        await DB.prepare(`
          DELETE FROM submission_wallet_verification
          WHERE submission_id IN (SELECT id FROM submissions WHERE list_id=?)
        `).bind(listId).run();
        await DB.prepare(`
          DELETE FROM copy_batch_items
          WHERE submission_id IN (SELECT id FROM submissions WHERE list_id=?)
        `).bind(listId).run();
        await DB.prepare(`DELETE FROM copy_batches WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM submissions WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM csv_checkpoints WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM list_settings WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM list_activity WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM list_folders WHERE list_id=?`).bind(listId).run();
        await DB.prepare(`DELETE FROM lists WHERE id=?`).bind(listId).run();

        return json({ ok:true });
      }

      if (reqUrl.pathname === "/api/revenue-summary" && request.method === "GET") {
        const dynamicRows = await freezeEligibleRevenue();
        const dynamicDetails = await getDynamicRevenueDetails();
        const snapshots = await DB.prepare(`
          SELECT month,amount,frozen_at
          FROM monthly_revenue_snapshots
          ORDER BY month DESC
        `).all();
        const snapshotDetails = await DB.prepare(`
          SELECT month,list_id,list_name,url_count,unit_price,amount
          FROM monthly_revenue_snapshot_details
          ORDER BY month DESC,list_name ASC
        `).all();
        const frozenMap = new Map((snapshots.results || []).map(x => [x.month,x]));
        const dynamicMap = new Map(dynamicRows.map(x => [x.month,Number(x.amount||0)]));
        const currentMonth = currentJstMonth();
        const currentDate = currentJstDateParts();
        const todayRevenue = await DB.prepare(`
          SELECT COALESCE(SUM(ls.unit_price),0) AS amount
          FROM submissions s
          JOIN list_settings ls ON ls.list_id=s.list_id
          WHERE date(datetime(s.created_at,'+9 hours'))=?
        `).bind(currentDate.date).first();
        const months = new Set([...dynamicMap.keys(),...frozenMap.keys(),currentMonth]);
        const revenues = [...months].sort((a,b)=>b.localeCompare(a)).map(month => {
          const frozen = frozenMap.get(month);
          const sourceDetails = frozen ? (snapshotDetails.results || []) : dynamicDetails;
          const configuredAdjustment = revenueAdjustmentFor(month);
          const frozenHasAdjustment = Boolean(frozen) && (snapshotDetails.results || []).some(
            x => x.month === month && x.list_id === '__manual_adjustment__'
          );
          // 既に固定済みの月でも、過去に補正なしで固定されていた場合は表示時に補正する。
          // 補正明細が保存済みなら二重加算しない。
          const adjustment = frozen
            ? (frozenHasAdjustment ? 0 : configuredAdjustment)
            : configuredAdjustment;
          const details = sourceDetails.filter(x=>x.month===month).map(x=>({
            list_id:x.list_id,
            list_name:x.list_name,
            url_count:Number(x.url_count||0),
            unit_price:Number(x.unit_price||0),
            amount:Number(x.amount||0)
          }));
          if (adjustment) {
            details.push({
              list_id:'__manual_adjustment__',
              list_name:'システム導入前未反映分',
              url_count:0,
              unit_price:0,
              amount:adjustment
            });
          }
          return {
            month,
            amount:(frozen ? Number(frozen.amount||0) : Number(dynamicMap.get(month)||0)) + adjustment,
            frozen:Boolean(frozen),
            frozen_at:frozen?.frozen_at || null,
            freeze_on:`${addMonth(month,1)}-06`,
            details
          };
        });
        return json({ok:true,current_month:currentMonth,current_date:currentDate.date,today_amount:Number(todayRevenue?.amount||0),revenues});
      }

      if (reqUrl.pathname === "/api/active-list" && request.method === "GET") {
        const active = await DB.prepare(`
          SELECT l.id,l.name
          FROM meta m
          JOIN lists l ON l.id=m.value
          WHERE m.key='active_list'
        `).first();
        return json({ ok:true, active:active || null });
      }

      if (reqUrl.pathname === "/api/active-list" && request.method === "POST") {
        const body = await request.json();
        const listId = String(body.list_id || body.listId || "").trim();

        const list = await DB.prepare(`
          SELECT id,name FROM lists WHERE id=?
        `).bind(listId).first();

        if (!list) return json({ ok:false, error:"指定されたリストがありません" }, 404);

        await DB.prepare(`
          INSERT INTO meta (key,value)
          VALUES ('active_list',?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `).bind(listId).run();

        return json({ ok:true, active:list });
      }

      if (reqUrl.pathname === "/api/submit" && request.method === "POST") {
        let body = {};
        const contentType = request.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          body = await request.json();
        } else {
          const form = await request.formData();
          body = Object.fromEntries(form);
        }

        const submittedUrl = String(body.url || "").trim();
        const deviceId = String(body.device_id || body.deviceId || "").trim();

        if (!submittedUrl) return json({ ok:false, error:"URLがありません" }, 400);

        let parsedUrl;
        try { parsedUrl = new URL(submittedUrl); }
        catch { return json({ ok:false, error:"正しいURLではありません" }, 400); }

        if (!["http:","https:"].includes(parsedUrl.protocol)) {
          return json({ ok:false, error:"HTTP/HTTPS URLのみ保存できます" }, 400);
        }

        const active = await DB.prepare(`
          SELECT l.id,l.name
          FROM meta m
          JOIN lists l ON l.id=m.value
          WHERE m.key='active_list'
        `).first();

        if (!active) {
          return json({ ok:false, error:"保存先リストが選択されていません" }, 409);
        }

        const id = crypto.randomUUID();
        const result = await DB.prepare(`
          INSERT OR IGNORE INTO submissions (id,list_id,url,device_id)
          VALUES (?,?,?,?)
        `).bind(id,active.id,submittedUrl,deviceId || null).run();

        const saved = Number(result.meta?.changes || 0) > 0;

        const countRow = await DB.prepare(`
          SELECT COUNT(*) AS count
          FROM submissions
          WHERE list_id=?
        `).bind(active.id).first();

        return json({
          ok:true,
          saved,
          duplicate:!saved,
          list_id:active.id,
          list_name:active.name,
          list_count:Number(countRow?.count || 0)
        });
      }

      if (reqUrl.pathname.startsWith("/api/submissions/") && request.method === "GET") {
        const listId = decodeURIComponent(
          reqUrl.pathname.substring("/api/submissions/".length)
        );

        const list = await DB.prepare(`
          SELECT id,name FROM lists WHERE id=?
        `).bind(listId).first();

        if (!list) return json({ ok:false, error:"リストがありません" }, 404);

        await ensureProcessingTables();
        await ensureWalletStatusTable();
        const result = await DB.prepare(`
          SELECT s.id,s.url,s.device_id,s.created_at,
                 COALESCE(scs.export_count,0) AS csv_export_count,
                 scs.last_exported_at,
                 COALESCE(sps.process_count,0) AS process_count,
                 sps.processed_at,sps.processed_method,
                 COALESCE(sws.status,'pending') AS wallet_status,
                 sws.completed_at AS wallet_completed_at,
                 swv.verified_at AS wallet_verified_at
          FROM submissions s
          LEFT JOIN submission_csv_status scs ON scs.submission_id=s.id
          LEFT JOIN submission_processing_status sps ON sps.submission_id=s.id
          LEFT JOIN submission_wallet_status sws ON sws.submission_id=s.id
          LEFT JOIN submission_wallet_verification swv ON swv.submission_id=s.id
          WHERE s.list_id=?
          ORDER BY s.rowid ASC
        `).bind(listId).all();

        return json({
          ok:true,
          list,
          submissions:result.results || []
        });
      }

      // えらべるPay用：未対応のうち最も古いURLを1件返す。
      const walletNextMatch = reqUrl.pathname.match(/^\/api\/wallet-next\/([^/]+)$/);
      if (walletNextMatch && request.method === "GET") {
        const listId = decodeURIComponent(walletNextMatch[1]);
        const list = await DB.prepare(`SELECT id,name FROM lists WHERE id=?`).bind(listId).first();
        if (!list) return json({ok:false,error:'リストがありません'},404);
        if (String(list.name||'').trim().toLowerCase() !== 'えらべるpay') {
          return json({ok:false,error:'えらべるpay専用の機能です'},409);
        }
        await ensureWalletStatusTable();
        const item = await DB.prepare(`
          SELECT s.id,s.url,s.created_at
          FROM submissions s
          LEFT JOIN submission_wallet_status sws ON sws.submission_id=s.id
          WHERE s.list_id=? AND COALESCE(sws.status,'pending')<>'completed'
          ORDER BY s.rowid ASC LIMIT 1
        `).bind(listId).first();
        const count = await DB.prepare(`
          SELECT COUNT(*) AS count
          FROM submissions s
          LEFT JOIN submission_wallet_status sws ON sws.submission_id=s.id
          WHERE s.list_id=? AND COALESCE(sws.status,'pending')<>'completed'
        `).bind(listId).first();
        return json({ok:true,list,item:item||null,remaining_count:Number(count?.count||0)});
      }

      const walletCompleteMatch = reqUrl.pathname.match(/^\/api\/wallet-complete\/([^/]+)$/);
      if (walletCompleteMatch && request.method === "POST") {
        const submissionId = decodeURIComponent(walletCompleteMatch[1]);
        const item = await DB.prepare(`
          SELECT s.id,s.list_id,l.name AS list_name
          FROM submissions s JOIN lists l ON l.id=s.list_id WHERE s.id=?
        `).bind(submissionId).first();
        if (!item) return json({ok:false,error:'対象URLがありません'},404);
        if (String(item.list_name||'').trim().toLowerCase() !== 'えらべるpay') {
          return json({ok:false,error:'えらべるpay専用の機能です'},409);
        }
        await ensureWalletStatusTable();
        await DB.prepare(`
          INSERT INTO submission_wallet_status (submission_id,status,completed_at)
          VALUES (?,'completed',CURRENT_TIMESTAMP)
          ON CONFLICT(submission_id) DO UPDATE SET status='completed',completed_at=CURRENT_TIMESTAMP
        `).bind(submissionId).run();
        const saved = await DB.prepare(`
          SELECT completed_at FROM submission_wallet_status WHERE submission_id=?
        `).bind(submissionId).first();
        return json({ok:true,submission_id:submissionId,completed_at:saved?.completed_at});
      }

      // 初回移行操作済み・未確認のうち、最も古いURLを1件返す。
      const walletRecheckMatch = reqUrl.pathname.match(/^\/api\/wallet-recheck-next\/([^/]+)$/);
      if (walletRecheckMatch && request.method === "GET") {
        const listId = decodeURIComponent(walletRecheckMatch[1]);
        const list = await DB.prepare(`SELECT id,name FROM lists WHERE id=?`).bind(listId).first();
        if (!list) return json({ok:false,error:'リストがありません'},404);
        if (String(list.name||'').trim().toLowerCase() !== 'えらべるpay') {
          return json({ok:false,error:'えらべるpay専用の機能です'},409);
        }
        await ensureWalletStatusTable();
        const item = await DB.prepare(`
          SELECT s.id,s.url,s.created_at,sws.completed_at
          FROM submissions s
          JOIN submission_wallet_status sws ON sws.submission_id=s.id AND sws.status='completed'
          LEFT JOIN submission_wallet_verification swv ON swv.submission_id=s.id
          WHERE s.list_id=? AND swv.submission_id IS NULL
          ORDER BY s.rowid ASC LIMIT 1
        `).bind(listId).first();
        const count = await DB.prepare(`
          SELECT COUNT(*) AS count
          FROM submissions s
          JOIN submission_wallet_status sws ON sws.submission_id=s.id AND sws.status='completed'
          LEFT JOIN submission_wallet_verification swv ON swv.submission_id=s.id
          WHERE s.list_id=? AND swv.submission_id IS NULL
        `).bind(listId).first();
        return json({ok:true,list,item:item||null,remaining_count:Number(count?.count||0)});
      }

      const walletVerifyMatch = reqUrl.pathname.match(/^\/api\/wallet-verify\/([^/]+)$/);
      if (walletVerifyMatch && request.method === "POST") {
        const submissionId = decodeURIComponent(walletVerifyMatch[1]);
        await ensureWalletStatusTable();
        const item = await DB.prepare(`
          SELECT s.id,s.list_id,l.name AS list_name,sws.status
          FROM submissions s
          JOIN lists l ON l.id=s.list_id
          LEFT JOIN submission_wallet_status sws ON sws.submission_id=s.id
          WHERE s.id=?
        `).bind(submissionId).first();
        if (!item) return json({ok:false,error:'対象URLがありません'},404);
        if (String(item.list_name||'').trim().toLowerCase() !== 'えらべるpay') {
          return json({ok:false,error:'えらべるpay専用の機能です'},409);
        }
        if (item.status !== 'completed') {
          return json({ok:false,error:'初回の移行操作が完了していません'},409);
        }
        await DB.prepare(`
          INSERT INTO submission_wallet_verification (submission_id,verified_at)
          VALUES (?,CURRENT_TIMESTAMP)
          ON CONFLICT(submission_id) DO UPDATE SET verified_at=CURRENT_TIMESTAMP
        `).bind(submissionId).run();
        const saved = await DB.prepare(`
          SELECT verified_at FROM submission_wallet_verification WHERE submission_id=?
        `).bind(submissionId).first();
        return json({ok:true,submission_id:submissionId,verified_at:saved?.verified_at});
      }

      // 個別URLの修正・保存先移動。修正したURLだけ未抽出へ戻す。
      const submissionMatch = reqUrl.pathname.match(/^\/api\/submission\/([^/]+)$/);
      if (submissionMatch && request.method === "POST") {
        const submissionId = decodeURIComponent(submissionMatch[1]);
        const body = await request.json();
        const nextUrl = String(body.url || '').trim();
        const nextListId = String(body.list_id || '').trim();
        if (!validHttpUrl(nextUrl)) {
          return json({ok:false,error:'HTTP/HTTPSの正しいURLを入力してください'},400);
        }
        const current = await DB.prepare(`
          SELECT id,list_id,url FROM submissions WHERE id=?
        `).bind(submissionId).first();
        if (!current) return json({ok:false,error:'対象URLがありません'},404);
        const targetList = await DB.prepare(`SELECT id FROM lists WHERE id=?`)
          .bind(nextListId).first();
        if (!targetList) return json({ok:false,error:'移動先リストがありません'},404);
        const duplicate = await DB.prepare(`
          SELECT id FROM submissions
          WHERE list_id=? AND url=? AND id<>?
        `).bind(nextListId,nextUrl,submissionId).first();
        if (duplicate) return json({ok:false,error:'移動先に同じURLが保存されています'},409);
        if (current.list_id === nextListId && current.url === nextUrl) {
          return json({ok:true,unchanged:true});
        }
        // 固定対象月は現在の値で先に確定し、過去の確定収益を変えない。
        await freezeEligibleRevenue();
        await ensureProcessingTables();
        await ensureWalletStatusTable();
        await ensureSubmissionChangeLogTable();
        await DB.prepare(`
          UPDATE submissions SET list_id=?,url=? WHERE id=?
        `).bind(nextListId,nextUrl,submissionId).run();
        await DB.prepare(`
          INSERT INTO submission_change_log
          (id,submission_id,action,old_list_id,new_list_id,old_url,new_url)
          VALUES (?,?,?,?,?,?,?)
        `).bind(
          crypto.randomUUID(),submissionId,
          current.list_id === nextListId ? 'edit' : 'move',
          current.list_id,nextListId,current.url,nextUrl
        ).run();
        await DB.prepare(`
          INSERT INTO submission_csv_status (submission_id,export_count,last_exported_at)
          VALUES (?,0,NULL)
          ON CONFLICT(submission_id) DO UPDATE SET export_count=0,last_exported_at=NULL
        `).bind(submissionId).run();
        await DB.prepare(`
          INSERT INTO submission_processing_status
          (submission_id,process_count,processed_at,processed_method,last_batch_id)
          VALUES (?,0,NULL,NULL,NULL)
          ON CONFLICT(submission_id) DO UPDATE SET
            process_count=0,processed_at=NULL,processed_method=NULL,last_batch_id=NULL
        `).bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_wallet_status WHERE submission_id=?`)
          .bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_wallet_verification WHERE submission_id=?`)
          .bind(submissionId).run();
        return json({ok:true,id:submissionId,list_id:nextListId,url:nextUrl});
      }

      // 個別URLの削除。削除前の内容は変更履歴に残す。
      if (submissionMatch && request.method === "DELETE") {
        const submissionId = decodeURIComponent(submissionMatch[1]);
        const current = await DB.prepare(`
          SELECT id,list_id,url FROM submissions WHERE id=?
        `).bind(submissionId).first();
        if (!current) return json({ok:false,error:'対象URLがありません'},404);
        await freezeEligibleRevenue();
        await ensureProcessingTables();
        await ensureWalletStatusTable();
        await ensureSubmissionChangeLogTable();
        await DB.prepare(`
          INSERT INTO submission_change_log
          (id,submission_id,action,old_list_id,old_url)
          VALUES (?,?,?,?,?)
        `).bind(crypto.randomUUID(),submissionId,'delete',current.list_id,current.url).run();
        await DB.prepare(`DELETE FROM submissions WHERE id=?`).bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_csv_status WHERE submission_id=?`)
          .bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_processing_status WHERE submission_id=?`)
          .bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_wallet_status WHERE submission_id=?`)
          .bind(submissionId).run();
        await DB.prepare(`DELETE FROM submission_wallet_verification WHERE submission_id=?`)
          .bind(submissionId).run();
        return json({ok:true,id:submissionId});
      }

      // 未処理URLを端末へコピーするための作業バッチを作成する。
      if (reqUrl.pathname === "/api/copy-batches" && request.method === "POST") {
        const body = await request.json();
        const listId = String(body.list_id || '').trim();
        await ensureProcessingTables();
        const list = await DB.prepare(`SELECT id,name FROM lists WHERE id=?`).bind(listId).first();
        if (!list) return json({ok:false,error:'リストがありません'},404);
        const batchId = crypto.randomUUID();
        await DB.prepare(`INSERT INTO copy_batches (id,list_id,status) VALUES (?,?,'pending')`)
          .bind(batchId,listId).run();
        await DB.prepare(`
          INSERT INTO copy_batch_items (batch_id,submission_id)
          SELECT ?,s.id
          FROM submissions s
          JOIN submission_processing_status ps ON ps.submission_id=s.id
          WHERE s.list_id=? AND ps.process_count=0
        `).bind(batchId,listId).run();
        const rows = await DB.prepare(`
          SELECT s.id,s.url,s.created_at
          FROM copy_batch_items bi
          JOIN submissions s ON s.id=bi.submission_id
          WHERE bi.batch_id=?
          ORDER BY s.rowid ASC
        `).bind(batchId).all();
        if (!(rows.results||[]).length) {
          await DB.prepare(`DELETE FROM copy_batches WHERE id=?`).bind(batchId).run();
          return json({ok:false,error:'未抽出URLはありません'},409);
        }
        const batch = await DB.prepare(`
          SELECT id,list_id,status,created_at,completed_at FROM copy_batches WHERE id=?
        `).bind(batchId).first();
        return json({ok:true,batch:{...batch,list_name:list.name,count:rows.results.length,items:rows.results}});
      }

      const copyBatchMatch = reqUrl.pathname.match(/^\/api\/copy-batches\/([^/]+)$/);
      if (copyBatchMatch && request.method === "GET") {
        const batchId = decodeURIComponent(copyBatchMatch[1]);
        await ensureProcessingTables();
        const batch = await DB.prepare(`
          SELECT b.id,b.list_id,b.status,b.created_at,b.completed_at,l.name AS list_name
          FROM copy_batches b LEFT JOIN lists l ON l.id=b.list_id WHERE b.id=?
        `).bind(batchId).first();
        if (!batch) return json({ok:false,error:'作業中のCOPYがありません'},404);
        const rows = await DB.prepare(`
          SELECT s.id,s.url,s.created_at
          FROM copy_batch_items bi
          JOIN submissions s ON s.id=bi.submission_id
          WHERE bi.batch_id=? ORDER BY s.rowid ASC
        `).bind(batchId).all();
        return json({ok:true,batch:{...batch,count:(rows.results||[]).length,items:rows.results||[]}});
      }

      const completeCopyMatch = reqUrl.pathname.match(/^\/api\/copy-batches\/([^/]+)\/complete$/);
      if (completeCopyMatch && request.method === "POST") {
        const batchId = decodeURIComponent(completeCopyMatch[1]);
        await ensureProcessingTables();
        const batch = await DB.prepare(`SELECT id,status FROM copy_batches WHERE id=?`)
          .bind(batchId).first();
        if (!batch) return json({ok:false,error:'作業中のCOPYがありません'},404);
        if (batch.status === 'pending') {
          const result = await DB.prepare(`
            UPDATE submission_processing_status
            SET process_count=1,processed_at=CURRENT_TIMESTAMP,
                processed_method='copy',last_batch_id=?
            WHERE process_count=0
              AND submission_id IN (
                SELECT submission_id FROM copy_batch_items WHERE batch_id=?
              )
          `).bind(batchId,batchId).run();
          await DB.prepare(`
            UPDATE copy_batches SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?
          `).bind(batchId).run();
          const completed = await DB.prepare(`SELECT completed_at FROM copy_batches WHERE id=?`)
            .bind(batchId).first();
          return json({ok:true,batch_id:batchId,completed_at:completed?.completed_at,
            changed_count:Number(result.meta?.changes||0)});
        }
        const completed = await DB.prepare(`SELECT completed_at FROM copy_batches WHERE id=?`)
          .bind(batchId).first();
        return json({ok:true,batch_id:batchId,completed_at:completed?.completed_at,changed_count:0});
      }

      const undoCopyMatch = reqUrl.pathname.match(/^\/api\/copy-batches\/([^/]+)\/undo$/);
      if (undoCopyMatch && request.method === "POST") {
        const batchId = decodeURIComponent(undoCopyMatch[1]);
        await ensureProcessingTables();
        const batch = await DB.prepare(`
          SELECT id,status,completed_at,
                 (strftime('%s','now')-strftime('%s',completed_at)) AS age_seconds
          FROM copy_batches WHERE id=?
        `).bind(batchId).first();
        if (!batch || batch.status!=='completed') {
          return json({ok:false,error:'取り消せるCOPY完了記録がありません'},409);
        }
        if (Number(batch.age_seconds)>10) {
          return json({ok:false,error:'取り消し可能時間を過ぎました'},409);
        }
        const result = await DB.prepare(`
          UPDATE submission_processing_status
          SET process_count=0,processed_at=NULL,processed_method=NULL,last_batch_id=NULL
          WHERE last_batch_id=?
        `).bind(batchId).run();
        await DB.prepare(`
          UPDATE copy_batches SET status='undone',undone_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(batchId).run();
        return json({ok:true,undone_count:Number(result.meta?.changes||0)});
      }

      if (copyBatchMatch && request.method === "DELETE") {
        const batchId = decodeURIComponent(copyBatchMatch[1]);
        await ensureProcessingTables();
        await DB.prepare(`
          UPDATE copy_batches SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='pending'
        `).bind(batchId).run();
        return json({ok:true});
      }

      // 未処理CSVは処理済みにする。全件バックアップは状態を変更しない。
      const csvExportMatch = reqUrl.pathname.match(/^\/api\/(?:csv-export|csv-checkpoint)\/([^/]+)$/);
      if (csvExportMatch && request.method === "POST") {
        const listId = decodeURIComponent(csvExportMatch[1]);
        const body = await request.json().catch(()=>({}));
        const mode = body.mode === 'backup' ? 'backup' : 'unprocessed';
        const csvToken = `csv:${crypto.randomUUID()}`;
        await ensureProcessingTables();

        const list = await DB.prepare(`
          SELECT id,name FROM lists WHERE id=?
        `).bind(listId).first();
        if (!list) return json({ ok:false, error:"リストがありません" }, 404);

        const countRow = await DB.prepare(`
          SELECT COUNT(*) AS count
          FROM submissions s
          JOIN submission_processing_status ps ON ps.submission_id=s.id
          WHERE s.list_id=? AND (?='backup' OR ps.process_count=0)
        `).bind(listId,mode).first();
        if (!Number(countRow?.count||0)) {
          return json({ok:false,error:"CSVに出力するURLがありません"},409);
        }
        if (mode === 'unprocessed') {
          await DB.prepare(`
            UPDATE submission_csv_status
            SET export_count=export_count+1,last_exported_at=CURRENT_TIMESTAMP
            WHERE submission_id IN (
              SELECT s.id FROM submissions s
              JOIN submission_processing_status ps ON ps.submission_id=s.id
              WHERE s.list_id=? AND ps.process_count=0
            )
          `).bind(listId).run();
          await DB.prepare(`
            UPDATE submission_processing_status
            SET process_count=1,processed_at=CURRENT_TIMESTAMP,
                processed_method='csv',last_batch_id=?
            WHERE process_count=0
              AND submission_id IN (SELECT id FROM submissions WHERE list_id=?)
          `).bind(csvToken,listId).run();
        }
        const submissions = await DB.prepare(`
          SELECT s.id,s.url,s.device_id,s.created_at,
                 scs.export_count AS csv_export_count,scs.last_exported_at
          FROM submissions s
          JOIN submission_csv_status scs ON scs.submission_id=s.id
          JOIN submission_processing_status ps ON ps.submission_id=s.id
          WHERE s.list_id=?
            AND (?='backup' OR ps.last_batch_id=?)
          ORDER BY s.rowid ASC
        `).bind(listId,mode,csvToken).all();
        return json({ok:true,list,mode,submissions:submissions.results||[]});
      }

      if (reqUrl.pathname.startsWith("/api/csv/") && request.method === "GET") {
        const listId = decodeURIComponent(reqUrl.pathname.substring("/api/csv/".length));

        const list = await DB.prepare(`
          SELECT id,name FROM lists WHERE id=?
        `).bind(listId).first();

        if (!list) return json({ ok:false, error:"リストがありません" }, 404);

        const result = await DB.prepare(`
          SELECT url,device_id,created_at
          FROM submissions
          WHERE list_id=?
          ORDER BY rowid ASC
        `).bind(listId).all();

        const escapeCsv = value => `"${String(value ?? "").replaceAll('"','""')}"`;
        const rows = [
          ["URL","端末","登録日時"],
          ...(result.results || []).map(row => [row.url,row.device_id || "",row.created_at])
        ];
        const csv = "\uFEFF" + rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
        const safeName = list.name.replace(/[\\/:*?"<>|]/g,"_");

        return new Response(csv, {
          headers: {
            ...cors,
            "Content-Type":"text/csv; charset=utf-8",
            "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeName + ".csv")}`,
          },
        });
      }

      if (reqUrl.pathname === "/api/export-data" && request.method === "GET") {
        const lists = await DB.prepare(`
          SELECT id,name,created_at FROM lists ORDER BY created_at ASC
        `).all();

        const output = [];
        for (const list of lists.results || []) {
          const submissions = await DB.prepare(`
            SELECT url,device_id,created_at
            FROM submissions
            WHERE list_id=?
            ORDER BY rowid ASC
          `).bind(list.id).all();

          output.push({
            id:list.id,
            name:list.name,
            submissions:submissions.results || []
          });
        }
        return json({ ok:true, lists:output });
      }

      return json({ ok:false, error:"Not Found" }, 404);
    } catch (error) {
      return json({ ok:false, error:String(error?.message || error) }, 500);
    }
  },
};
