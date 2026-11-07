/* Потреби роти — фронтенд (vanilla JS, без збірки). */
(function () {
  'use strict';

  const CFG = window.CONFIG || {};
  const DEMO = !CFG.API_URL;
  const CATEGORIES = ['Особисті', 'Потреби підрозділу', 'Ремонт/заміна', 'Медичні', 'Інше'];
  const PRIORITIES = ['Терміново', 'Звичайно', 'Не терміново'];
  const STATUSES = ['Нова', 'В роботі', 'Замовлено', 'Видано', 'Відхилено', 'Скасовано'];
  const OPEN = ['Нова', 'В роботі', 'Замовлено'];
  const CAT_HINTS = {
    'Особисті': 'Форма, взуття, термобілизна, рюкзак, спальник, гігієна…',
    'Потреби підрозділу': 'Дрони, рації, генератор, оптика, павербанки, інструмент…',
    'Ремонт/заміна': 'Що зламалось / втрачено і потребує заміни',
    'Медичні': 'Турнікети, IFAK, бинти, ліки…',
    'Інше': 'Будь-що інше',
  };

  const $app = document.getElementById('app');
  const $who = document.getElementById('who');
  let state = {
    token: lsGet('rp_token'),
    user: null,
    tab: 'new',
    myReqs: [],
    allReqs: [],
    users: [],
    filters: { status: 'open', category: '', unit: '', priority: '', q: '' },
    selected: new Set(),
    summary: false,
  };

  document.title = CFG.TITLE || 'Потреби роти';
  document.getElementById('brand').textContent = CFG.TITLE || 'Потреби роти';
  if (DEMO) document.getElementById('demoBanner').classList.remove('hidden');

  /* ============ Утиліти ============ */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function slug(s) { return String(s).replace(/\s+/g, '_'); }
  function fmtDate(d) {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x)) return esc(d);
    return x.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
      x.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  }
  function opts(list, sel, empty) {
    return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
      list.map(v => `<option ${v === sel ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
  }
  function badge(kind, v) { return `<span class="badge ${kind}-${esc(slug(v))}">${esc(v)}</span>`; }
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3500);
  }
  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = v; });
    return o;
  }

  /* ============ API ============ */
  async function call(action, payload) {
    let res;
    if (DEMO) {
      res = Demo.handle({ action, token: state.token, payload: payload || {} });
    } else {
      const r = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: state.token, payload: payload || {} }),
      });
      res = await r.json();
    }
    if (!res.ok) {
      if (res.error === 'AUTH') { logoutLocal(); throw new Error('Сесія завершилась, увійдіть знову'); }
      throw new Error(res.error || 'Помилка');
    }
    return res;
  }

  async function busy(btn, fn) {
    const old = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Зачекайте…'; }
    try { return await fn(); }
    catch (e) { toast(e.message); }
    finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; } }
  }

  function logoutLocal() {
    state.token = null; state.user = null; lsSet('rp_token', null);
    render();
  }

  /* ============ Рендер ============ */
  function render() {
    renderWho();
    if (!state.user) return renderLogin();
    const isAdmin = state.user.role === 'admin';
    const tabs = [['new', 'Нова заявка'], ['mine', 'Мої заявки']];
    if (isAdmin) tabs.push(['all', 'Усі заявки'], ['users', 'Особовий склад']);
    tabs.push(['profile', 'Профіль']);
    if (!tabs.some(t => t[0] === state.tab)) state.tab = 'new';

    $app.innerHTML = `<nav class="tabs">${tabs.map(([k, l]) =>
      `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${l}</button>`).join('')}</nav>
      <section id="view"></section>`;
    $app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); });
    const v = document.getElementById('view');
    ({ new: viewNew, mine: viewMine, all: viewAll, users: viewUsers, profile: viewProfile })[state.tab](v);
  }

  function renderWho() {
    if (!state.user) { $who.innerHTML = ''; return; }
    const u = state.user;
    $who.innerHTML = `<span>${esc(u.rank ? u.rank + ' ' : '')}${esc(u.name)}${u.role === 'admin' ? ' · адмін' : ''}</span>
      <button class="small" id="logoutBtn">Вийти</button>`;
    document.getElementById('logoutBtn').onclick = async () => {
      try { await call('logout'); } catch (e) {}
      logoutLocal();
    };
  }

  /* ---- Вхід / реєстрація ---- */
  function renderLogin(mode) {
    if (mode === 'register') {
      $app.innerHTML = `<div class="card narrow"><h2>Реєстрація</h2>
        <form id="f">
          <label>ПІБ *</label><input name="name" required maxlength="100" autocomplete="name">
          <div class="row">
            <div><label>Звання</label><input name="rank" maxlength="50"></div>
            <div><label>Позивний</label><input name="callsign" maxlength="50"></div>
          </div>
          <label>Підрозділ (взвод/відділення)</label><input name="unit" maxlength="80" placeholder="напр. 1 взвод">
          <label>Телефон</label><input name="phone" maxlength="30" type="tel">
          <label>Логін * (латиницею)</label><input name="login" required pattern="[A-Za-z0-9_.\\-]{3,30}" autocomplete="username">
          <label>Пароль * (мін. 6 символів)</label><input name="password" type="password" required minlength="6" autocomplete="new-password">
          <div class="actions"><button class="primary" type="submit">Зареєструватись</button>
          <button type="button" class="link" id="toLogin">Вже маю обліковий запис</button></div>
        </form></div>`;
      document.getElementById('toLogin').onclick = () => renderLogin();
      const f = document.getElementById('f');
      f.onsubmit = e => {
        e.preventDefault();
        busy(f.querySelector('.primary'), async () => {
          const r = await call('register', formData(f));
          toast(r.msg); renderLogin();
        });
      };
      return;
    }
    $app.innerHTML = `<div class="card narrow"><h2>Вхід</h2>
      <form id="f">
        <label>Логін</label><input name="login" required autocomplete="username">
        <label>Пароль</label><input name="password" type="password" required autocomplete="current-password">
        <div class="actions"><button class="primary" type="submit">Увійти</button>
        <button type="button" class="link" id="toReg">Реєстрація</button></div>
      </form>
      <p class="muted" style="font-size:13px">Після реєстрації старшина має підтвердити ваш обліковий запис.</p></div>`;
    document.getElementById('toReg').onclick = () => renderLogin('register');
    const f = document.getElementById('f');
    f.onsubmit = e => {
      e.preventDefault();
      busy(f.querySelector('.primary'), async () => {
        const r = await call('login', formData(f));
        state.token = r.token; state.user = r.user; lsSet('rp_token', r.token);
        state.tab = 'new'; render();
      });
    };
  }

  /* ---- Нова заявка ---- */
  function itemRowHtml(i) {
    return `<div class="item-row" data-i="${i}">
      ${i > 0 ? '<button type="button" class="small danger remove">✕</button>' : ''}
      <div class="row">
        <div><label>Категорія</label><select name="category">${opts(CATEGORIES, 'Особисті')}</select></div>
        <div><label>Пріоритет</label><select name="priority">${opts(PRIORITIES, 'Звичайно')}</select></div>
      </div>
      <label>Найменування *</label><input name="item" required maxlength="200" placeholder="${esc(CAT_HINTS['Особисті'])}">
      <div class="row">
        <div><label>Кількість</label><input name="qty" type="number" min="1" max="9999" value="1"></div>
        <div><label>Розмір / модель</label><input name="size" maxlength="30" placeholder="напр. 44, XL, 52-4"></div>
      </div>
      <label>Коментар</label><textarea name="comment" maxlength="500" placeholder="Деталі, причина, посилання…"></textarea>
    </div>`;
  }

  function viewNew(v) {
    v.innerHTML = `<div class="card"><h2>Нова заявка</h2>
      <form id="f"><div class="items-list" id="items">${itemRowHtml(0)}</div>
      <div class="actions">
        <button type="button" id="addItem">+ Додати ще позицію</button>
        <button class="primary" type="submit">Надіслати заявку</button>
      </div></form></div>`;
    const list = document.getElementById('items');
    let n = 1;
    const wire = row => {
      const cat = row.querySelector('[name=category]');
      cat.onchange = () => { row.querySelector('[name=item]').placeholder = CAT_HINTS[cat.value] || ''; };
      const rm = row.querySelector('.remove');
      if (rm) rm.onclick = () => row.remove();
    };
    wire(list.firstElementChild);
    document.getElementById('addItem').onclick = () => {
      list.insertAdjacentHTML('beforeend', itemRowHtml(n++));
      wire(list.lastElementChild);
    };
    const f = document.getElementById('f');
    f.onsubmit = e => {
      e.preventDefault();
      const items = [...list.querySelectorAll('.item-row')].map(r => {
        const o = {};
        r.querySelectorAll('[name]').forEach(el => { o[el.name] = el.value; });
        return o;
      });
      busy(f.querySelector('.primary'), async () => {
        const r = await call('createRequest', { items });
        toast(`Надіслано позицій: ${r.ids.length}`);
        state.tab = 'mine'; render();
      });
    };
  }

  /* ---- Мої заявки ---- */
  async function viewMine(v) {
    v.innerHTML = '<div class="card"><div class="empty">Завантаження…</div></div>';
    try { state.myReqs = (await call('myRequests')).requests; } catch (e) { toast(e.message); return; }
    if (state.tab !== 'mine') return;
    const rs = state.myReqs;
    if (!rs.length) { v.innerHTML = '<div class="card"><div class="empty">Заявок ще немає</div></div>'; return; }
    v.innerHTML = `<div class="card"><h2>Мої заявки</h2>${rs.map(r => `
      <div class="req-card">
        <div class="h"><div><b>${esc(r.item)}</b> × ${esc(r.qty)}${r.size ? ` · ${esc(r.size)}` : ''}
          <div class="sub muted" style="font-size:12px">${esc(r.category)} · ${fmtDate(r.created)} · ${esc(r.id)}</div></div>
          <div>${badge('st', r.status)}</div></div>
        ${r.comment ? `<div style="margin-top:6px">${esc(r.comment)}</div>` : ''}
        ${r.adminComment ? `<div style="margin-top:6px"><b>Відповідь старшини:</b> ${esc(r.adminComment)}</div>` : ''}
        <div style="margin-top:6px">${badge('pr', r.priority)}
        ${r.status === 'Нова' ? `<button class="small danger" data-cancel="${esc(r.id)}" style="float:right">Скасувати</button>` : ''}</div>
      </div>`).join('')}</div>`;
    v.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => {
      if (!confirm('Скасувати заявку?')) return;
      busy(b, async () => { await call('cancelRequest', { id: b.dataset.cancel }); toast('Скасовано'); render(); });
    });
  }

  /* ---- Усі заявки (адмін) ---- */
  async function viewAll(v, keep) {
    if (!keep) {
      v.innerHTML = '<div class="card"><div class="empty">Завантаження…</div></div>';
      try { state.allReqs = (await call('allRequests')).requests; } catch (e) { toast(e.message); return; }
      if (state.tab !== 'all') return;
      state.selected.clear();
    }
    const all = state.allReqs;
    const F = state.filters;
    const units = [...new Set(all.map(r => r.unit).filter(Boolean))].sort();
    const q = F.q.trim().toLowerCase();
    const rows = all.filter(r =>
      (F.status === 'open' ? OPEN.includes(r.status) : !F.status || r.status === F.status) &&
      (!F.category || r.category === F.category) &&
      (!F.unit || r.unit === F.unit) &&
      (!F.priority || r.priority === F.priority) &&
      (!q || [r.item, r.name, r.comment, r.id, r.size].join(' ').toLowerCase().includes(q)));

    const count = s => all.filter(r => r.status === s).length;
    const stat = (key, label, n) => `<div class="stat" data-st="${key}"><div class="n">${n}</div><div class="l">${label}</div></div>`;

    v.innerHTML = `
      <div class="stats">
        ${stat('open', 'Відкриті', all.filter(r => OPEN.includes(r.status)).length)}
        ${stat('Нова', 'Нові', count('Нова'))}
        ${stat('В роботі', 'В роботі', count('В роботі'))}
        ${stat('Замовлено', 'Замовлено', count('Замовлено'))}
        ${stat('Видано', 'Видано', count('Видано'))}
      </div>
      <div class="card">
        <div class="filters">
          <select id="fStatus"><option value="open" ${F.status === 'open' ? 'selected' : ''}>Відкриті</option>${opts(STATUSES, F.status, 'Усі статуси')}</select>
          <select id="fCat">${opts(CATEGORIES, F.category, 'Усі категорії')}</select>
          <select id="fUnit">${opts(units, F.unit, 'Усі підрозділи')}</select>
          <select id="fPr">${opts(PRIORITIES, F.priority, 'Будь-який пріоритет')}</select>
          <input id="fQ" placeholder="Пошук…" value="${esc(F.q)}">
        </div>
        <div class="actions" style="margin:0 0 12px">
          <select id="bulkSt" style="width:auto">${opts(STATUSES, '', 'Змінити статус обраних…')}</select>
          <button id="bulkGo" class="small">Застосувати</button>
          <button id="sumBtn" class="small">${state.summary ? 'Список заявок' : 'Зведення для закупівлі'}</button>
          <button id="csvBtn" class="small">Експорт CSV</button>
          <button id="reload" class="small">Оновити</button>
          <span class="muted" style="align-self:center;font-size:13px">Показано: ${rows.length}</span>
        </div>
        <div id="listArea"></div>
      </div>`;

    const area = document.getElementById('listArea');
    if (state.summary) area.innerHTML = summaryHtml(rows);
    else area.innerHTML = rows.length ? tableHtml(rows) : '<div class="empty">Нічого не знайдено</div>';

    // фільтри
    const bindF = (id, key, ev) => { document.getElementById(id)[ev || 'onchange'] = e => { F[key] = e.target.value; viewAll(v, true); }; };
    bindF('fStatus', 'status'); bindF('fCat', 'category'); bindF('fUnit', 'unit'); bindF('fPr', 'priority');
    const fq = document.getElementById('fQ');
    fq.oninput = () => { F.q = fq.value; clearTimeout(fq._t); fq._t = setTimeout(() => { viewAll(v, true); const n = document.getElementById('fQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    v.querySelectorAll('[data-st]').forEach(s => s.onclick = () => { F.status = s.dataset.st; viewAll(v, true); });
    document.getElementById('reload').onclick = () => viewAll(v);
    document.getElementById('sumBtn').onclick = () => { state.summary = !state.summary; viewAll(v, true); };
    document.getElementById('csvBtn').onclick = () => exportCsv(rows);
    document.getElementById('bulkGo').onclick = e => {
      const st = document.getElementById('bulkSt').value;
      const ids = [...state.selected].filter(id => rows.some(r => r.id === id));
      if (!st || !ids.length) return toast('Оберіть заявки та статус');
      busy(e.target, async () => { await call('updateRequest', { ids, status: st }); toast(`Оновлено: ${ids.length}`); viewAll(v); });
    };

    // рядки таблиці
    area.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => {
      cb.checked ? state.selected.add(cb.dataset.sel) : state.selected.delete(cb.dataset.sel);
    });
    const selAll = area.querySelector('#selAll');
    if (selAll) selAll.onchange = () => area.querySelectorAll('[data-sel]').forEach(cb => {
      cb.checked = selAll.checked; selAll.checked ? state.selected.add(cb.dataset.sel) : state.selected.delete(cb.dataset.sel);
    });
    area.querySelectorAll('[data-status]').forEach(s => s.onchange = () => {
      busy(null, async () => {
        await call('updateRequest', { id: s.dataset.status, status: s.value });
        const r = all.find(x => x.id === s.dataset.status); if (r) r.status = s.value;
        toast('Статус змінено');
      });
    });
    area.querySelectorAll('[data-comment]').forEach(b => b.onclick = () => {
      const r = all.find(x => x.id === b.dataset.comment);
      const txt = prompt('Коментар для бійця:', r.adminComment || '');
      if (txt === null) return;
      busy(b, async () => { await call('updateRequest', { id: r.id, adminComment: txt }); r.adminComment = txt; viewAll(v, true); });
    });
  }

  function tableHtml(rows) {
    const statusSel = r => `<select data-status="${esc(r.id)}" style="width:auto;padding:4px">${opts(STATUSES, r.status)}</select>`;
    const tbl = `<div class="table-wrap mobile-cards"><table><thead><tr>
      <th><input type="checkbox" id="selAll" style="width:auto"></th><th>Дата</th><th>Хто</th><th>Що</th><th>К-ть</th>
      <th>Категорія</th><th>Пріоритет</th><th>Статус</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td><input type="checkbox" data-sel="${esc(r.id)}" ${state.selected.has(r.id) ? 'checked' : ''} style="width:auto"></td>
        <td style="white-space:nowrap">${fmtDate(r.created)}<div class="sub">${esc(r.id)}</div></td>
        <td>${esc(r.name)}<div class="sub">${esc(r.unit)}</div></td>
        <td><b>${esc(r.item)}</b>${r.size ? `<div class="sub">розмір: ${esc(r.size)}</div>` : ''}
          ${r.comment ? `<div class="sub">${esc(r.comment)}</div>` : ''}
          ${r.adminComment ? `<div class="sub">↳ ${esc(r.adminComment)}</div>` : ''}</td>
        <td>${esc(r.qty)}</td><td>${esc(r.category)}</td><td>${badge('pr', r.priority)}</td>
        <td>${statusSel(r)}</td>
        <td><button class="small" data-comment="${esc(r.id)}">💬</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    const cards = `<div class="req-cards">${rows.map(r => `<div class="req-card">
        <div class="h"><div><label style="margin:0;display:inline"><input type="checkbox" data-sel="${esc(r.id)}" ${state.selected.has(r.id) ? 'checked' : ''} style="width:auto"></label>
          <b>${esc(r.item)}</b> × ${esc(r.qty)}${r.size ? ` · ${esc(r.size)}` : ''}</div>${badge('pr', r.priority)}</div>
        <div class="muted" style="font-size:12px">${esc(r.name)} · ${esc(r.unit)} · ${esc(r.category)} · ${fmtDate(r.created)}</div>
        ${r.comment ? `<div>${esc(r.comment)}</div>` : ''}
        ${r.adminComment ? `<div class="muted">↳ ${esc(r.adminComment)}</div>` : ''}
        <div class="actions" style="margin-top:6px">${statusSel(r)}<button class="small" data-comment="${esc(r.id)}">💬 Коментар</button></div>
      </div>`).join('')}</div>`;
    return tbl + cards;
  }

  function summaryHtml(rows) {
    const map = new Map();
    rows.forEach(r => {
      const key = [r.category, String(r.item).trim().toLowerCase(), String(r.size || '').trim().toLowerCase()].join('|');
      const g = map.get(key) || { category: r.category, item: r.item, size: r.size, qty: 0, who: new Set(), urgent: 0 };
      g.qty += Number(r.qty) || 0; g.who.add(r.name); if (r.priority === 'Терміново') g.urgent++;
      map.set(key, g);
    });
    const list = [...map.values()].sort((a, b) => b.urgent - a.urgent || b.qty - a.qty);
    if (!list.length) return '<div class="empty">Нічого не знайдено</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Категорія</th><th>Найменування</th><th>Розмір</th>
      <th>Разом</th><th>Терміново</th><th>Для кого</th></tr></thead><tbody>
      ${list.map(g => `<tr><td>${esc(g.category)}</td><td><b>${esc(g.item)}</b></td><td>${esc(g.size)}</td>
        <td><b>${g.qty}</b></td><td>${g.urgent || ''}</td><td class="sub">${esc([...g.who].join(', '))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function exportCsv(rows) {
    const cols = [['id', 'ID'], ['created', 'Дата'], ['name', 'ПІБ'], ['unit', 'Підрозділ'], ['category', 'Категорія'],
      ['item', 'Найменування'], ['qty', 'Кількість'], ['size', 'Розмір'], ['priority', 'Пріоритет'],
      ['comment', 'Коментар'], ['status', 'Статус'], ['adminComment', 'Відповідь']];
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const csv = '﻿' + [cols.map(c => q(c[1])).join(';')]
      .concat(rows.map(r => cols.map(([k]) => q(k === 'created' ? fmtDate(r[k]) : r[k])).join(';'))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'potreby_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---- Особовий склад (адмін) ---- */
  async function viewUsers(v) {
    v.innerHTML = '<div class="card"><div class="empty">Завантаження…</div></div>';
    try { state.users = (await call('listUsers')).users; } catch (e) { toast(e.message); return; }
    if (state.tab !== 'users') return;
    const order = { pending: 0, active: 1, blocked: 2 };
    const us = state.users.slice().sort((a, b) => order[a.status] - order[b.status] || String(a.name).localeCompare(b.name, 'uk'));
    const stLabel = { pending: '⏳ Очікує', active: '✅ Активний', blocked: '⛔ Заблоковано' };
    v.innerHTML = `<div class="card"><h2>Особовий склад (${us.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>ПІБ</th><th>Підрозділ</th><th>Логін</th><th>Телефон</th><th>Статус</th><th>Роль</th><th></th></tr></thead><tbody>
      ${us.map(u => `<tr>
        <td>${esc(u.rank)} <b>${esc(u.name)}</b>${u.callsign ? `<div class="sub">«${esc(u.callsign)}»</div>` : ''}</td>
        <td>${esc(u.unit)}</td><td>${esc(u.login)}</td><td>${esc(u.phone)}</td>
        <td style="white-space:nowrap">${stLabel[u.status] || esc(u.status)}</td>
        <td>${u.role === 'admin' ? 'адмін' : 'боєць'}</td>
        <td><div class="actions" style="margin:0">
          ${u.status !== 'active' ? `<button class="small primary" data-act="activate" data-l="${esc(u.login)}">Підтвердити</button>` : ''}
          ${u.status === 'active' && u.login !== state.user.login ? `<button class="small danger" data-act="block" data-l="${esc(u.login)}">Блок</button>` : ''}
          ${u.login !== state.user.login ? `<button class="small" data-act="role" data-l="${esc(u.login)}">${u.role === 'admin' ? 'Зняти адміна' : 'Зробити адміном'}</button>` : ''}
          <button class="small" data-act="reset" data-l="${esc(u.login)}">Скинути пароль</button>
        </div></td></tr>`).join('')}
      </tbody></table></div></div>`;
    v.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const login = b.dataset.l, u = us.find(x => x.login === login);
      const act = b.dataset.act;
      busy(b, async () => {
        if (act === 'activate') await call('updateUser', { login, status: 'active' });
        if (act === 'block') { if (!confirm('Заблокувати ' + u.name + '?')) return; await call('updateUser', { login, status: 'blocked' }); }
        if (act === 'role') await call('updateUser', { login, role: u.role === 'admin' ? 'user' : 'admin' });
        if (act === 'reset') {
          if (!confirm('Скинути пароль для ' + u.name + '?')) return;
          const r = await call('resetPassword', { login });
          prompt('Новий тимчасовий пароль (передайте бійцю):', r.password);
        }
        toast('Готово'); viewUsers(v);
      });
    });
  }

  /* ---- Профіль ---- */
  function viewProfile(v) {
    const u = state.user;
    v.innerHTML = `<div class="card narrow"><h2>Профіль</h2>
      <p><b>${esc(u.rank)} ${esc(u.name)}</b>${u.callsign ? ` «${esc(u.callsign)}»` : ''}<br>
      <span class="muted">${esc(u.unit)} · логін: ${esc(u.login)}${u.phone ? ' · ' + esc(u.phone) : ''}</span></p>
      <form id="f"><h2 style="margin-top:20px">Змінити пароль</h2>
        <label>Старий пароль</label><input type="password" name="oldPassword" required autocomplete="current-password">
        <label>Новий пароль (мін. 6)</label><input type="password" name="newPassword" required minlength="6" autocomplete="new-password">
        <div class="actions"><button class="primary" type="submit">Змінити</button></div>
      </form></div>`;
    const f = document.getElementById('f');
    f.onsubmit = e => {
      e.preventDefault();
      busy(f.querySelector('.primary'), async () => { await call('changePassword', formData(f)); f.reset(); toast('Пароль змінено'); });
    };
  }

  /* ============ Демо-бекенд (localStorage) ============ */
  const Demo = {
    db() {
      let d; try { d = JSON.parse(lsGet('rp_demo') || 'null'); } catch (e) {}
      if (!d) {
        const now = new Date().toISOString();
        d = {
          users: [
            { login: 'admin', password: 'admin123', name: 'Старшина роти', rank: 'ст. сержант', unit: 'Управління роти', callsign: 'Батя', phone: '', role: 'admin', status: 'active', created: now },
            { login: 'ivan', password: 'ivan123', name: 'Петренко Іван', rank: 'солдат', unit: '1 взвод', callsign: 'Кіт', phone: '', role: 'user', status: 'active', created: now },
            { login: 'oleh', password: 'oleh123', name: 'Коваль Олег', rank: 'мол. сержант', unit: '2 взвод', callsign: '', phone: '', role: 'user', status: 'pending', created: now },
          ],
          reqs: [
            { id: 'R-DEMO1', created: now, login: 'ivan', name: 'Петренко Іван', unit: '1 взвод', category: 'Особисті', item: 'Берці зимові', qty: 1, size: '44', priority: 'Терміново', comment: 'Старі порвались', status: 'Нова', adminComment: '' },
            { id: 'R-DEMO2', created: now, login: 'ivan', name: 'Петренко Іван', unit: '1 взвод', category: 'Медичні', item: 'Турнікет CAT', qty: 2, size: '', priority: 'Звичайно', comment: '', status: 'Замовлено', adminComment: 'Буде в п’ятницю' },
            { id: 'R-DEMO3', created: now, login: 'admin', name: 'Старшина роти', unit: 'Управління роти', category: 'Потреби підрозділу', item: 'Павербанк 20000 mAh', qty: 6, size: '', priority: 'Звичайно', comment: 'На взвод', status: 'В роботі', adminComment: '' },
          ],
          sess: {},
        };
      }
      return d;
    },
    save(d) { lsSet('rp_demo', JSON.stringify(d)); },
    handle({ action: a, token, payload: p }) {
      const d = this.db();
      const pub = u => { const o = Object.assign({}, u); delete o.password; return o; };
      try {
        if (a === 'register') {
          const login = String(p.login || '').toLowerCase().trim();
          if (d.users.some(u => u.login === login)) throw new Error('Такий логін вже зайнятий');
          d.users.push({ login, password: p.password, name: p.name, rank: p.rank, unit: p.unit, callsign: p.callsign, phone: p.phone, role: 'user', status: 'pending', created: new Date().toISOString() });
          this.save(d); return { ok: true, msg: 'Заявку на реєстрацію надіслано. Дочекайтесь підтвердження старшини.' };
        }
        if (a === 'login') {
          const u = d.users.find(x => x.login === String(p.login || '').toLowerCase().trim() && x.password === p.password);
          if (!u) throw new Error('Невірний логін або пароль');
          if (u.status === 'pending') throw new Error('Обліковий запис ще не підтверджено старшиною');
          if (u.status !== 'active') throw new Error('Обліковий запис заблоковано');
          const t = Math.random().toString(36).slice(2) + Date.now();
          d.sess[t] = u.login; this.save(d); return { ok: true, token: t, user: pub(u) };
        }
        const me = d.users.find(u => u.login === d.sess[token] && u.status === 'active');
        if (!me) return { ok: false, error: 'AUTH' };
        if (a === 'me') return { ok: true, user: pub(me) };
        if (a === 'logout') { delete d.sess[token]; this.save(d); return { ok: true }; }
        if (a === 'changePassword') {
          if (me.password !== p.oldPassword) throw new Error('Старий пароль невірний');
          me.password = p.newPassword; this.save(d); return { ok: true };
        }
        if (a === 'myRequests') return { ok: true, requests: d.reqs.filter(r => r.login === me.login).slice().reverse() };
        if (a === 'createRequest') {
          const ids = p.items.map(it => {
            if (!String(it.item || '').trim()) throw new Error('Вкажіть найменування');
            const r = Object.assign({}, it, { id: 'R-' + Math.random().toString(36).slice(2, 7).toUpperCase(), created: new Date().toISOString(), login: me.login, name: me.name, unit: me.unit, qty: Math.max(1, parseInt(it.qty, 10) || 1), status: 'Нова', adminComment: '' });
            d.reqs.push(r); return r.id;
          });
          this.save(d); return { ok: true, ids };
        }
        if (a === 'cancelRequest') {
          const r = d.reqs.find(x => x.id === p.id && x.login === me.login);
          if (!r || r.status !== 'Нова') throw new Error('Можна скасувати лише нову заявку');
          r.status = 'Скасовано'; this.save(d); return { ok: true };
        }
        if (me.role !== 'admin') throw new Error('Недостатньо прав');
        if (a === 'allRequests') return { ok: true, requests: d.reqs.slice().reverse() };
        if (a === 'updateRequest') {
          (p.ids || [p.id]).forEach(id => {
            const r = d.reqs.find(x => x.id === id); if (!r) return;
            if (p.status !== undefined) r.status = p.status;
            if (p.adminComment !== undefined) r.adminComment = p.adminComment;
          });
          this.save(d); return { ok: true };
        }
        if (a === 'listUsers') return { ok: true, users: d.users.map(pub) };
        if (a === 'updateUser') {
          const u = d.users.find(x => x.login === p.login);
          if (p.status) u.status = p.status; if (p.role) u.role = p.role;
          this.save(d); return { ok: true };
        }
        if (a === 'resetPassword') {
          const u = d.users.find(x => x.login === p.login); u.password = Math.random().toString(36).slice(2, 10);
          this.save(d); return { ok: true, password: u.password };
        }
        throw new Error('Невідома дія');
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };

  /* ============ Старт ============ */
  (async function init() {
    if (state.token) {
      try { state.user = (await call('me')).user; } catch (e) { state.user = null; }
    }
    render();
  })();
})();
