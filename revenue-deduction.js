(() => {
  const control = $('todayRevenueControl');
  const modal = $('revenueDeductionModal');
  const form = $('revenueDeductionForm');
  const dateInput = $('revenueDeductionDate');
  const amountInput = $('revenueDeductionAmount');
  const save = $('revenueDeductionSave');
  const cancel = $('revenueDeductionCancel');
  const error = $('revenueDeductionError');
  const pendingKey = 'winning-url-pending-revenue-deduction-v1';
  let busy = false;
  let pending = null;
  let press = null;
  let timer = null;
  function todayJst() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function preview() {
    const [year, month, day] = dateInput.value.split('-').map(Number);
    const amount = Number(amountInput.value);
    $('revenueDeductionPreview').textContent = year && month && day
      ? `${year}年${month}月${day}日の収益と、${month}月の収益から${amount > 0 ? amount.toLocaleString() + '円を' : '同じ額を'}減算します。`
      : '減算する日付と金額を入力してください。';
  }
  function syncForm() {
    dateInput.readOnly = amountInput.readOnly = busy || Boolean(pending);
    save.disabled = cancel.disabled = busy;
    save.textContent = busy ? '保存中…' : pending ? '再送して確認' : '減算する';
    preview();
  }
  function open() {
    if (modal.classList.contains('show')) return;
    try {
      const stored = JSON.parse(localStorage.getItem(pendingKey) || 'null');
      if (stored && typeof stored.date === 'string' && Number.isSafeInteger(stored.amount) && typeof stored.request_id === 'string') pending = stored;
    } catch {}
    dateInput.max = todayJst();
    dateInput.value = pending?.date || dateInput.max;
    amountInput.value = pending?.amount || '';
    error.textContent = pending ? '前回の保存結果を確認します。「再送して確認」を押してください。' : '';
    syncForm();
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    (pending ? save : dateInput).focus();
  }
  function close() {
    if (busy) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    control.focus({preventScroll:true});
  }
  function cancelPress() {
    clearTimeout(timer);
    press = null;
  }
  control.addEventListener('pointerdown', e => {
    cancelPress();
    if (!e.isPrimary || e.button !== 0) return;
    press = {x:e.clientX, y:e.clientY};
    timer = setTimeout(() => { cancelPress(); open(); }, 550);
  });
  control.addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  });
  ['pointerup','pointercancel'].forEach(type => document.addEventListener(type, cancelPress));
  control.addEventListener('pointerleave', cancelPress);
  window.addEventListener('scroll', cancelPress, true);
  control.addEventListener('contextmenu', e => e.preventDefault());
  control.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const items = [...form.querySelectorAll('input,button')].filter(el => !el.disabled);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  cancel.onclick = close;
  dateInput.oninput = amountInput.oninput = preview;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    const amount = Number(amountInput.value);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999) {
      error.textContent = '減算額を1円以上の整数で入力してください。'; return;
    }
    if (!pending) {
      const request = {date:dateInput.value, amount, request_id:crypto.randomUUID()};
      try { localStorage.setItem(pendingKey, JSON.stringify(request)); }
      catch { error.textContent = '保存の準備ができませんでした。ブラウザの保存設定を確認してください。'; return; }
      pending = request;
    }
    busy = true;
    error.textContent = '';
    syncForm();
    let saved = null;
    try {
      saved = await call('/api/revenue/deduct', {method:'POST', body:JSON.stringify(pending)});
      if (!saved?.ok || saved.request_id !== pending.request_id) throw new Error('保存結果を確認できませんでした');
      pending = null;
      try { localStorage.removeItem(pendingKey); } catch {}
    } catch (e) {
      if ([400,401,403,404,409].includes(e.status)) {
        pending = null;
        try { localStorage.removeItem(pendingKey); } catch {}
      }
      error.textContent = e.message + (pending ? '\n同じ内容で再送しても二重には減算されません。' : '');
      saved = null;
    } finally {
      busy = false;
      syncForm();
    }
    if (!saved) return;
    close();
    await loadCurrentRevenue();
    if ($('revenueModal').classList.contains('show')) await loadRevenueSummary();
    setStatus(`${saved.date}の収益と${monthLabel(saved.month)}収益から${Number(saved.deducted_amount).toLocaleString()}円を減算しました`);
  });
})();
