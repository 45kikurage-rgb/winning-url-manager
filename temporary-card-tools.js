(() => {
  'use strict';

  const TEMP_LIST_NAME = 'URL一時保存';
  const ANALYZER_API = 'https://coupon-capture.45kikurage.workers.dev/api/analyze';
  const CACHE_KEY = 'winning-url-temp-analysis-v1';
  const selectedIds = new Set();
  let analysisCache = loadCache();
  let running = false;
  let syncing = false;
  let observer = null;

  function loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(analysisCache)); } catch {}
  }

  function fingerprint(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function isTemporaryList() {
    return String(currentActive?.name || '').trim() === TEMP_LIST_NAME;
  }

  function supportedCouponUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      const seven = url.protocol === 'https:' && url.hostname === 'coupon.sej.co.jp' &&
        url.pathname === '/order/cpnsp_03.do' && url.searchParams.has('hansoku_id');
      const famima = url.protocol === 'https:' && url.hostname === 'ncpfa.famima.com' &&
        url.pathname === '/prd/ebcweb' && ['eKey','cpNo','gyNo'].every(key => url.searchParams.has(key));
      return seven || famima;
    } catch {
      return false;
    }
  }

  function resultResolved(result) {
    return result?.status === 'used' || (
      result?.status === 'ok' &&
      ['350','500','other','none'].includes(String(result.size || '')) &&
      result.product && result.product !== '商品名不明'
    );
  }

  function cachedFor(row) {
    const cached = analysisCache[row.id];
    if (!cached || cached.fingerprint !== fingerprint(row.url)) return null;
    return cached;
  }

  function capacityLabel(result) {
    if (!result) return '未判定';
    if (result.status === 'used') return '利用済み';
    if (result.status === 'unsupported') return '対象外';
    if (result.status === 'error') return '判定失敗';
    if (result.size === '350') return '350ml';
    if (result.size === '500') return '500ml';
    if (result.size === 'other') return result.capacity || 'その他';
    if (result.size === 'none') return '容量表記なし';
    return '判定不能';
  }

  function statusLabel(result) {
    if (!result) return '未判定';
    if (result.status === 'used') return '利用済み';
    if (result.status === 'unsupported') return '対象外';
    if (result.status === 'error') return '判定失敗';
    if (resultResolved(result)) return '判定済み';
    return '要確認';
  }

  function installStyles() {
    if (document.getElementById('temporaryCardToolStyles')) return;
    const style = document.createElement('style');
    style.id = 'temporaryCardToolStyles';
    style.textContent = `
      #temporaryCardPanel{margin:0 0 12px;padding:12px;border:2px solid #f4d33f;background:#080808;color:#fff;font-family:inherit}
      #temporaryCardPanel *{box-sizing:border-box}
      .tempToolHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.tempToolTitle{font-size:16px;font-weight:1000}.tempToolCount{font-size:11px;color:#d1d5db}
      .tempAnalyzeBtn{width:100%;min-height:44px;border:2px solid #fff;background:#fff;color:#000;font-weight:1000}
      .tempAnalyzeBtn:disabled{opacity:.45}.tempProgress{height:7px;margin:8px 0 4px;border:1px solid #666;background:#171717;overflow:hidden}.tempProgress>div{height:100%;width:0;background:#fff;transition:width .15s}.tempProgressText{min-height:18px;font-size:11px;color:#d1d5db;text-align:right}
      .tempFilters{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.tempFilters select,.tempMoveSelect{width:100%;min-width:0;padding:9px 7px;border:1px solid #666;background:#111;color:#fff;font:inherit;font-size:12px}
      .tempSelectBar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding:8px;border:1px solid #555}.tempSelectAll{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:900}.tempSelectAll input,.tempRowCheck input{width:19px;height:19px;margin:0;accent-color:#f4d33f}.tempSelectedCount{font-size:12px;font-weight:1000}
      .tempMoveRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:7px}.tempMoveBtn{min-width:108px;border:2px solid #fff;background:#000;color:#fff}.tempActions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.tempActions button{min-height:42px;border:2px solid #fff;background:#000;color:#fff}.tempActions button:disabled,.tempMoveBtn:disabled{opacity:.4}
      .tempRowCheck{display:inline-flex;align-items:center;gap:5px;margin:0 0 6px;font-size:11px;font-weight:1000;color:#111}.tempAnalyzeMeta{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}.tempAnalyzeTag{display:inline-flex;align-items:center;min-height:24px;padding:3px 7px;border:1px solid #9ca3af;border-radius:6px;background:#f9fafb;color:#111;font-size:10px;font-weight:900}.tempAnalyzeTag.is-ok{border-color:#22c55e;background:#dcfce7}.tempAnalyzeTag.is-warn{border-color:#f59e0b;background:#fef3c7}.tempAnalyzeTag.is-error{border-color:#ef4444;background:#fee2e2}
      .urlItem.tempSelectedRow{outline:2px solid #f4d33f;outline-offset:-2px;background:#fffbea}.urlItem.tempFilteredOut{display:none!important}
      @media(max-width:360px){.tempFilters{grid-template-columns:1fr}.tempMoveRow{grid-template-columns:1fr}.tempMoveBtn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    const urlArea = document.getElementById('urlArea');
    if (!urlArea) return null;
    let panel = document.getElementById('temporaryCardPanel');
    if (!isTemporaryList()) {
      panel?.remove();
      return null;
    }
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'temporaryCardPanel';
    panel.innerHTML = `
      <div class="tempToolHead">
        <div class="tempToolTitle">URL振り分け</div>
        <div class="tempToolCount" id="tempToolCount">0件</div>
      </div>
      <button type="button" id="tempAnalyzeBtn" class="tempAnalyzeBtn">中身自動判定</button>
      <div class="tempProgress"><div id="tempProgressBar"></div></div>
      <div class="tempProgressText" id="tempProgressText"></div>
      <div class="tempFilters">
        <select id="tempProductFilter" aria-label="商品フィルター"><option value="">商品：すべて</option></select>
        <select id="tempSizeFilter" aria-label="容量フィルター"><option value="">容量：すべて</option></select>
      </div>
      <div class="tempSelectBar">
        <label class="tempSelectAll"><input type="checkbox" id="tempSelectAll">表示中をすべて選択</label>
        <span class="tempSelectedCount" id="tempSelectedCount">0件選択</span>
      </div>
      <div class="tempActions">
        <button type="button" id="tempCopyBtn">選択URLを一括コピー</button>
        <button type="button" id="tempClearSelectionBtn">選択解除</button>
      </div>
      <div class="tempMoveRow">
        <select id="tempMoveTarget" class="tempMoveSelect" aria-label="移動先カード"><option value="">移動先カードを選択</option></select>
        <button type="button" id="tempMoveBtn" class="tempMoveBtn">カードへ移動</button>
      </div>
    `;
    urlArea.parentElement?.insertBefore(panel, urlArea);

    panel.querySelector('#tempAnalyzeBtn').addEventListener('click', runAnalysis);
    panel.querySelector('#tempProductFilter').addEventListener('change', applyFilterAndSelection);
    panel.querySelector('#tempSizeFilter').addEventListener('change', applyFilterAndSelection);
    panel.querySelector('#tempSelectAll').addEventListener('change', event => {
      for (const rowEl of visibleRowElements()) {
        const id = rowEl.dataset.submissionId;
        if (!id) continue;
        if (event.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      }
      decorateRows();
      updateControls();
    });
    panel.querySelector('#tempCopyBtn').addEventListener('click', copySelected);
    panel.querySelector('#tempClearSelectionBtn').addEventListener('click', () => {
      selectedIds.clear(); decorateRows(); updateControls();
    });
    panel.querySelector('#tempMoveBtn').addEventListener('click', moveSelected);
    return panel;
  }

  function currentRows() {
    return Array.isArray(currentSubmissionRows) ? currentSubmissionRows : [];
  }

  function rowById(id) {
    return currentRows().find(row => String(row.id) === String(id));
  }

  function updateMoveTargets() {
    const select = document.getElementById('tempMoveTarget');
    if (!select) return;
    const currentValue = select.value;
    const lists = (Array.isArray(currentLists) ? currentLists : [])
      .filter(item => item?.id && item.id !== currentActive?.id)
      .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
    select.innerHTML = '<option value="">移動先カードを選択</option>';
    for (const list of lists) {
      const option = document.createElement('option');
      option.value = list.id;
      option.textContent = list.name || list.id;
      select.appendChild(option);
    }
    if (lists.some(item => item.id === currentValue)) select.value = currentValue;
  }

  function updateFilters() {
    const product = document.getElementById('tempProductFilter');
    const size = document.getElementById('tempSizeFilter');
    if (!product || !size) return;
    const oldProduct = product.value;
    const oldSize = size.value;
    const products = new Set();
    const sizes = new Set();
    for (const row of currentRows()) {
      const result = cachedFor(row);
      if (resultResolved(result)) {
        products.add(result.product);
        sizes.add(capacityLabel(result));
      } else if (result?.status === 'used') {
        products.add('利用済み');
        sizes.add('利用済み');
      }
    }
    product.innerHTML = '<option value="">商品：すべて</option>';
    [...products].sort((a,b)=>a.localeCompare(b,'ja')).forEach(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value; product.appendChild(option);
    });
    size.innerHTML = '<option value="">容量：すべて</option>';
    [...sizes].sort((a,b)=>a.localeCompare(b,'ja')).forEach(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value; size.appendChild(option);
    });
    if ([...product.options].some(o => o.value === oldProduct)) product.value = oldProduct;
    if ([...size.options].some(o => o.value === oldSize)) size.value = oldSize;
  }

  function decorateRows() {
    if (!isTemporaryList()) return;
    const panel = document.getElementById('temporaryCardPanel');
    if (!panel) return;
    for (const rowEl of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')) {
      const id = rowEl.dataset.submissionId;
      const row = rowById(id);
      if (!row) continue;
      let main = rowEl.querySelector('.urlMain');
      if (!main) main = rowEl.lastElementChild || rowEl;

      let check = main.querySelector('.tempRowCheck');
      if (!check) {
        check = document.createElement('label');
        check.className = 'tempRowCheck';
        check.innerHTML = '<input type="checkbox"><span>選択</span>';
        main.insertBefore(check, main.firstChild);
        check.querySelector('input').addEventListener('change', event => {
          if (event.target.checked) selectedIds.add(id); else selectedIds.delete(id);
          decorateRows(); updateControls();
        });
      }
      check.querySelector('input').checked = selectedIds.has(id);
      rowEl.classList.toggle('tempSelectedRow', selectedIds.has(id));

      let meta = main.querySelector('.tempAnalyzeMeta');
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'tempAnalyzeMeta';
        check.insertAdjacentElement('afterend', meta);
      }
      const result = cachedFor(row);
      meta.innerHTML = '';
      const values = resultResolved(result)
        ? [result.product, capacityLabel(result), statusLabel(result)]
        : result?.status === 'used'
          ? ['利用済み', statusLabel(result)]
          : [statusLabel(result)];
      for (const value of values) {
        const tag = document.createElement('span');
        tag.className = 'tempAnalyzeTag ' + (resultResolved(result) ? 'is-ok' : result?.status === 'error' ? 'is-error' : result ? 'is-warn' : '');
        tag.textContent = value;
        meta.appendChild(tag);
      }
    }
  }

  function rowMatchesFilter(row) {
    const productFilter = document.getElementById('tempProductFilter')?.value || '';
    const sizeFilter = document.getElementById('tempSizeFilter')?.value || '';
    const result = cachedFor(row);
    const product = result?.status === 'used' ? '利用済み' : resultResolved(result) ? result.product : '';
    const size = result?.status === 'used' ? '利用済み' : resultResolved(result) ? capacityLabel(result) : '';
    return (!productFilter || product === productFilter) && (!sizeFilter || size === sizeFilter);
  }

  function applyFilterAndSelection() {
    if (!isTemporaryList()) return;
    for (const rowEl of document.querySelectorAll('#urlArea .urlItem[data-submission-id]')) {
      const row = rowById(rowEl.dataset.submissionId);
      rowEl.classList.toggle('tempFilteredOut', Boolean(row && !rowMatchesFilter(row)));
    }
    const visibleIds = new Set(visibleRowElements().map(el => el.dataset.submissionId));
    const selectAll = document.getElementById('tempSelectAll');
    if (selectAll) {
      const visibleCount = visibleIds.size;
      const checked = [...visibleIds].filter(id => selectedIds.has(id)).length;
      selectAll.checked = visibleCount > 0 && checked === visibleCount;
      selectAll.indeterminate = checked > 0 && checked < visibleCount;
    }
    updateControls();
  }

  function visibleRowElements() {
    return [...document.querySelectorAll('#urlArea .urlItem[data-submission-id]')]
      .filter(el => !el.classList.contains('tempFilteredOut') && getComputedStyle(el).display !== 'none');
  }

  function updateControls() {
    if (!isTemporaryList()) return;
    const rows = currentRows();
    const supported = rows.filter(row => supportedCouponUrl(row.url)).length;
    const resolved = rows.filter(row => resultResolved(cachedFor(row)) || cachedFor(row)?.status === 'used').length;
    const failed = rows.filter(row => cachedFor(row)?.status === 'error').length;
    const count = document.getElementById('tempToolCount');
    if (count) count.textContent = `${rows.length}件／判定済 ${resolved}／対象 ${supported}${failed ? `／失敗 ${failed}` : ''}`;
    const selected = document.getElementById('tempSelectedCount');
    if (selected) selected.textContent = `${selectedIds.size}件選択`;
    for (const id of ['tempCopyBtn','tempMoveBtn','tempClearSelectionBtn']) {
      const button = document.getElementById(id);
      if (button) button.disabled = selectedIds.size === 0 || running;
    }
    const analyze = document.getElementById('tempAnalyzeBtn');
    if (analyze) analyze.disabled = running || supported === 0;
  }

  async function analyzeOne(item) {
    const response = await fetch(ANALYZER_API, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({items:[{label:item.id,url:item.url}]})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.results?.[0]) throw new Error(data.error || '確認に失敗しました');
    return data.results[0];
  }

  async function analyzePass(items, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        try {
          results[index] = await analyzeOne(item);
        } catch (error) {
          results[index] = {label:item.id,url:item.url,product:'商品名不明',size:'unknown',status:'error',message:error?.message || '確認に失敗しました'};
        }
        completed += 1;
        onProgress(completed, items.length);
      }
    }
    await Promise.all(Array.from({length:Math.min(4,items.length)}, worker));
    return results;
  }

  async function runAnalysis() {
    if (running || !isTemporaryList()) return;
    const rows = currentRows();
    const supportedRows = rows.filter(row => supportedCouponUrl(row.url));
    if (!supportedRows.length) {
      setStatus?.('一時保存カードに判定対応URLがありません', false);
      return;
    }

    let targetRows = supportedRows.filter(row => {
      const cached = cachedFor(row);
      return !cached || !resultResolved(cached) || cached.status === 'error';
    });
    if (!targetRows.length) targetRows = supportedRows;

    running = true;
    updateControls();
    const button = document.getElementById('tempAnalyzeBtn');
    const progressBar = document.getElementById('tempProgressBar');
    const progressText = document.getElementById('tempProgressText');
    if (button) button.textContent = '判定中…';

    try {
      let pending = targetRows.map(row => ({id:row.id,url:row.url}));
      const final = new Map();
      for (let pass = 0; pass <= 2 && pending.length; pass += 1) {
        const passLabel = pass === 0 ? '初回判定' : `再判定 ${pass}/2`;
        const results = await analyzePass(pending, (done,total) => {
          const percent = total ? Math.round(done / total * 100) : 0;
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressText) progressText.textContent = `${passLabel} ${done}/${total}件`;
        });
        for (const result of results) final.set(result.url, result);
        pending = results.filter(result => !resultResolved(result) && result.status !== 'used')
          .map(result => ({id:result.label,url:result.url}));
      }

      for (const row of targetRows) {
        const result = final.get(row.url);
        analysisCache[row.id] = {
          fingerprint: fingerprint(row.url),
          product: result?.product || '商品名不明',
          size: result?.size || 'unknown',
          capacity: result?.capacity || '',
          status: result?.status || 'error',
          message: result?.message || '',
          checkedAt: Date.now()
        };
      }
      for (const row of rows.filter(row => !supportedCouponUrl(row.url))) {
        analysisCache[row.id] = {fingerprint:fingerprint(row.url),product:'対象外',size:'none',capacity:'',status:'unsupported',message:'セブン・ファミマ以外',checkedAt:Date.now()};
      }
      saveCache();
      updateFilters();
      decorateRows();
      applyFilterAndSelection();
      const unresolved = targetRows.filter(row => !resultResolved(cachedFor(row)) && cachedFor(row)?.status !== 'used').length;
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = unresolved ? `完了／要確認 ${unresolved}件` : '判定完了';
      setStatus?.(unresolved ? `中身判定完了：要確認 ${unresolved}件` : '中身判定が完了しました ✓', unresolved === 0);
    } finally {
      running = false;
      if (button) button.textContent = '中身自動判定';
      updateControls();
    }
  }

  async function copySelected() {
    const rows = currentRows().filter(row => selectedIds.has(String(row.id)) || selectedIds.has(row.id));
    if (!rows.length) return;
    const text = rows.map(row => row.url).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus?.(`${rows.length}件のURLをコピーしました ✓`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
      document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
      setStatus?.(`${rows.length}件のURLをコピーしました ✓`);
    }
  }

  async function moveSelected() {
    if (running || !isTemporaryList() || !selectedIds.size) return;
    const targetId = document.getElementById('tempMoveTarget')?.value || '';
    const target = (Array.isArray(currentLists) ? currentLists : []).find(item => item.id === targetId);
    if (!target) {
      setStatus?.('移動先カードを選択してください', false);
      return;
    }
    const rows = currentRows().filter(row => selectedIds.has(String(row.id)) || selectedIds.has(row.id));
    if (!rows.length) return;
    const ok = typeof showSiteConfirm === 'function'
      ? await showSiteConfirm(`${rows.length}件を「${target.name || ''}」へ移動しますか？\n\n移動後は移動先カードの単価で収益が再計算されます。`)
      : confirm(`${rows.length}件を「${target.name || ''}」へ移動しますか？`);
    if (!ok) return;

    running = true;
    updateControls();
    const moveBtn = document.getElementById('tempMoveBtn');
    const progressBar = document.getElementById('tempProgressBar');
    const progressText = document.getElementById('tempProgressText');
    if (moveBtn) moveBtn.textContent = '移動中…';
    let cursor = 0;
    let completed = 0;
    let success = 0;
    const failed = [];

    async function worker() {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          await call('/api/submission/' + encodeURIComponent(row.id), {
            method:'POST',
            body:JSON.stringify({url:row.url,list_id:targetId})
          });
          success += 1;
          selectedIds.delete(row.id);
          selectedIds.delete(String(row.id));
          delete analysisCache[row.id];
        } catch (error) {
          failed.push({row,error});
        }
        completed += 1;
        const percent = Math.round(completed / rows.length * 100);
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `移動中 ${completed}/${rows.length}件`;
      }
    }

    try {
      await Promise.all(Array.from({length:Math.min(4,rows.length)}, worker));
      saveCache();
      if (success) {
        try { await call('/api/revenue/update', {method:'POST',body:'{}'}); } catch {}
      }
      await loadAll();
      if (failed.length) setStatus?.(`${success}件移動／${failed.length}件失敗`, false);
      else setStatus?.(`${success}件を「${target.name || ''}」へ移動しました ✓`);
    } finally {
      running = false;
      if (moveBtn) moveBtn.textContent = 'カードへ移動';
      if (progressBar) progressBar.style.width = '0%';
      if (progressText && !failed.length) progressText.textContent = '';
      sync();
    }
  }

  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      installStyles();
      if (!isTemporaryList()) {
        document.getElementById('temporaryCardPanel')?.remove();
        selectedIds.clear();
        return;
      }
      ensurePanel();
      updateMoveTargets();
      updateFilters();
      decorateRows();
      applyFilterAndSelection();
      updateControls();
    } finally {
      syncing = false;
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => queueMicrotask(sync));
    observer.observe(document.body, {childList:true,subtree:true});
    document.addEventListener('click', () => setTimeout(sync, 0), true);
    setInterval(sync, 1200);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, {once:true});
  else startObserver();
})();
