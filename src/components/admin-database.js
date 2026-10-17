/**
 * Fiches & Cloud — admin "Database" app.
 *
 * Read/inspect/delete browser across the `notes`, `links`, `shortcuts` and
 * `users` collections, with search, pagination and a JSON inspector.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState, showToast, iconImg } from '../app.js';

const PAGE_SIZE = 10;

const state = {
  container: null,
  tab: 'notes',       // notes | links | shortcuts | users
  query: '',
  page: 1,
  expandedId: null,
  data: { notes: [], links: [], shortcuts: [], users: [] },
  userMap: {}
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  container.classList.add('admin-container');

  const tab = (id, label) => `
    <button class="tab-btn ${state.tab === id ? 'tab-btn--active' : ''}" data-tab="${id}">
      ${label} <span class="tab-badge" data-count="${id}">0</span>
    </button>`;

  container.innerHTML = `
    <div class="admin-app">
      <div class="admin-app__header">
        <div class="admin-app__title">
          ${iconImg('database', { size: 24, alt: '' })}
          <h2>Base de données</h2>
          <span class="badge badge--admin">Admin</span>
        </div>
        <button class="btn btn--secondary" id="ad-refresh">${iconImg('refresh', { size: 16, alt: '' })}<span>Rafraîchir</span></button>
      </div>

      <div class="admin-app__toolbar">
        <div class="tabs-row">
          ${tab('notes', 'Fiches')}
          ${tab('links', 'Liens')}
          ${tab('shortcuts', 'Raccourcis')}
          ${tab('users', 'Utilisateurs')}
        </div>
        <div class="search-field">
          ${iconImg('search', { size: 16, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="ad-search" placeholder="Filtrer…" value="${escapeAttr(state.query)}">
        </div>
      </div>

      <div class="admin-app__body" id="ad-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement des collections…</p></div>
      </div>

      <div class="pagination" id="ad-pagination">
        <span class="pagination__info" id="ad-page-info">—</span>
        <div class="pagination__controls">
          <button class="btn btn--secondary btn--sm" id="ad-prev">&laquo; Précédent</button>
          <button class="btn btn--secondary btn--sm" id="ad-next">Suivant &raquo;</button>
        </div>
      </div>
    </div>
  `;

  bind();
  await loadAll();
}

function bind() {
  const c = state.container;

  c.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.tab === btn.dataset.tab) return;
      state.tab = btn.dataset.tab;
      state.page = 1;
      state.expandedId = null;
      c.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b === btn));
      renderTable();
    });
  });

  let timer = null;
  c.querySelector('#ad-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    state.query = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => { state.page = 1; renderTable(); }, 200);
  });

  c.querySelector('#ad-refresh')?.addEventListener('click', loadAll);
  c.querySelector('#ad-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page--; renderTable(); } });
  c.querySelector('#ad-next')?.addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(items().length / PAGE_SIZE));
    if (state.page < max) { state.page++; renderTable(); }
  });
}

async function loadAll() {
  const body = state.container?.querySelector('#ad-body');
  if (!body) return;
  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement des collections…</p></div>`;

  const safe = p => p.catch(err => { console.warn('[DB] collection failed:', err); return []; });

  try {
    const [notes, links, shortcuts, users] = await Promise.all([
      safe(FirestoreService.getAllNotes()),
      safe(FirestoreService.getAllLinks()),
      safe(FirestoreService.getAllShortcuts()),
      safe(FirestoreService.getAllUsers())
    ]);

    state.data = { notes, links, shortcuts, users };

    state.userMap = {};
    users.forEach(u => { state.userMap[u.id || u.uid] = u.displayName || u.email || `Utilisateur ${(u.id || u.uid).slice(0, 5)}`; });

    ['notes', 'links', 'shortcuts', 'users'].forEach(id => {
      const el = state.container.querySelector(`[data-count="${id}"]`);
      if (el) el.textContent = state.data[id].length;
    });

    renderTable();
  } catch (err) {
    console.error('[DB] load failed:', err);
    body.innerHTML = `<div class="empty-state"><p class="empty-state__title">Chargement impossible</p><p class="empty-state__description">${escapeHtml(err.message)}</p></div>`;
  }
}

/** Filtered rows for the active tab. */
function items() {
  const q = state.query;
  const rows = state.data[state.tab] || [];
  if (!q) return rows;

  return rows.filter(row => {
    const owner = state.userMap[row.uid] || row.uid || '';
    return [row.title, row.label, row.subject, row.url, row.email, row.displayName, row.role, owner, row.action]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
}

function renderTable() {
  const c = state.container;
  const body = c?.querySelector('#ad-body');
  const info = c?.querySelector('#ad-page-info');
  const prev = c?.querySelector('#ad-prev');
  const next = c?.querySelector('#ad-next');
  if (!body) return;

  const all = items();
  const total = all.length;
  const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), maxPages);

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = all.slice(start, start + PAGE_SIZE);

  if (info) info.textContent = total === 0 ? 'Aucun document' : `${start + 1}–${Math.min(start + PAGE_SIZE, total)} sur ${total}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= maxPages;

  if (pageRows.length === 0) {
    body.innerHTML = `<div class="empty-state"><p class="empty-state__title">Aucun document</p><p class="empty-state__description">Aucun document ne correspond dans « ${state.tab} ».</p></div>`;
    return;
  }

  const render = {
    notes: notesTable,
    links: linksTable,
    shortcuts: shortcutsTable,
    users: usersTable
  }[state.tab];

  body.innerHTML = `<div class="table-wrap"><table class="table">${render(pageRows)}</table></div>`;
  bindRows();
}

function notesTable(rows) {
  return `
    <thead><tr class="table__head">
      <th>Titre</th><th>Propriétaire</th><th>Matière</th><th>Car.</th><th>Publique</th><th>Créée</th><th class="table__cell--actions">Actions</th>
    </tr></thead>
    <tbody>${rows.map(n => `
      <tr class="table__row" data-id="${n.id}">
        <td class="table__cell table__cell--strong">${escapeHtml(truncate(n.title || 'Sans titre', 30))}</td>
        <td class="table__cell">${escapeHtml(state.userMap[n.uid] || n.uid || '—')}</td>
        <td class="table__cell"><span class="badge badge--subject">${escapeHtml(n.subject || 'Général')}</span></td>
        <td class="table__cell">${(n.charCount ?? (n.content || '').length).toLocaleString('fr-FR')}</td>
        <td class="table__cell">${n.isPublic ? '<span class="badge badge--public">Oui</span>' : '—'}</td>
        <td class="table__cell table__cell--muted">${formatDate(n.createdAt)}</td>
        <td class="table__cell table__cell--actions">
          <button class="btn btn--sm btn-json" data-id="${n.id}">JSON</button>
          <button class="btn btn--sm btn--danger btn-del" data-id="${n.id}" data-kind="note">Suppr.</button>
        </td>
      </tr>
      ${state.expandedId === n.id ? jsonRow(n, 7) : ''}`).join('')}
    </tbody>`;
}

function linksTable(rows) {
  return `
    <thead><tr class="table__head">
      <th>Titre</th><th>URL</th><th>Propriétaire</th><th>Matière</th><th>Créé</th><th class="table__cell--actions">Actions</th>
    </tr></thead>
    <tbody>${rows.map(l => `
      <tr class="table__row" data-id="${l.id}">
        <td class="table__cell table__cell--strong">${escapeHtml(truncate(l.title || 'Sans titre', 24))}</td>
        <td class="table__cell"><a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncate(l.url, 28))}</a></td>
        <td class="table__cell">${escapeHtml(state.userMap[l.uid] || l.uid || '—')}</td>
        <td class="table__cell"><span class="badge badge--subject">${escapeHtml(l.subject || 'Général')}</span></td>
        <td class="table__cell table__cell--muted">${formatDate(l.createdAt)}</td>
        <td class="table__cell table__cell--actions">
          <button class="btn btn--sm btn-json" data-id="${l.id}">JSON</button>
          <button class="btn btn--sm btn--danger btn-del" data-id="${l.id}" data-kind="link">Suppr.</button>
        </td>
      </tr>
      ${state.expandedId === l.id ? jsonRow(l, 6) : ''}`).join('')}
    </tbody>`;
}

function shortcutsTable(rows) {
  return `
    <thead><tr class="table__head">
      <th>Libellé</th><th>Icône</th><th>Action</th><th>Propriétaire</th><th class="table__cell--actions">Actions</th>
    </tr></thead>
    <tbody>${rows.map(s => `
      <tr class="table__row" data-id="${s.id}">
        <td class="table__cell table__cell--strong">${escapeHtml(s.label || '—')}</td>
        <td class="table__cell">${escapeHtml(s.icon || '—')}</td>
        <td class="table__cell">${escapeHtml(truncate(s.action || '—', 32))}</td>
        <td class="table__cell">${escapeHtml(state.userMap[s.uid] || s.uid || '—')}</td>
        <td class="table__cell table__cell--actions">
          <button class="btn btn--sm btn-json" data-id="${s.id}">JSON</button>
          <button class="btn btn--sm btn--danger btn-del" data-id="${s.id}" data-kind="shortcut">Suppr.</button>
        </td>
      </tr>
      ${state.expandedId === s.id ? jsonRow(s, 5) : ''}`).join('')}
    </tbody>`;
}

function usersTable(rows) {
  return `
    <thead><tr class="table__head">
      <th>Email</th><th>Nom</th><th>Rôle</th><th>Quota</th><th>Dernière connexion</th><th class="table__cell--actions">Actions</th>
    </tr></thead>
    <tbody>${rows.map(u => {
      const id = u.id || u.uid;
      const pct = u.quotaLimit ? Math.round(((u.quotaUsed || 0) / u.quotaLimit) * 100) : 0;
      return `
      <tr class="table__row" data-id="${id}">
        <td class="table__cell table__cell--strong">${escapeHtml(u.email || '—')}</td>
        <td class="table__cell">${escapeHtml(u.displayName || '—')}</td>
        <td class="table__cell"><span class="badge ${u.role === 'admin' ? 'badge--admin' : 'badge--user'}">${escapeHtml(u.role || 'user')}</span></td>
        <td class="table__cell">${(u.quotaUsed || 0).toLocaleString('fr-FR')} / ${(u.quotaLimit || 500000).toLocaleString('fr-FR')} (${pct}%)</td>
        <td class="table__cell table__cell--muted">${formatDate(u.lastLogin)}</td>
        <td class="table__cell table__cell--actions">
          <button class="btn btn--sm btn-json" data-id="${id}">JSON</button>
        </td>
      </tr>
      ${state.expandedId === id ? jsonRow(u, 6) : ''}`;
    }).join('')}
    </tbody>`;
}

function jsonRow(doc, span) {
  const clean = { ...doc };
  for (const k in clean) {
    if (clean[k]?.toDate && typeof clean[k].toDate === 'function') clean[k] = clean[k].toDate().toISOString();
  }
  const json = JSON.stringify(clean, null, 2);
  const id = doc.id || doc.uid;
  return `
    <tr class="table__row--json">
      <td colspan="${span}">
        <div class="json-viewer">
          <div class="json-viewer__head">
            <span>ID : <code>${escapeHtml(id)}</code></span>
            <button class="btn btn--sm btn-copy-json" data-json="${escapeAttr(json)}">Copier le JSON</button>
          </div>
          <pre class="json-code"><code>${escapeHtml(json)}</code></pre>
        </div>
      </td>
    </tr>`;
}

function bindRows() {
  const c = state.container;

  c.querySelectorAll('.btn-json').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.expandedId = state.expandedId === btn.dataset.id ? null : btn.dataset.id;
      renderTable();
    });
  });

  c.querySelectorAll('.btn-copy-json').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.json)
        .then(() => showToast('JSON copié.', 'success'))
        .catch(() => showToast('Copie impossible.', 'error'));
    });
  });

  c.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { id, kind } = btn.dataset;
      if (!confirm(`Supprimer définitivement ce document (${kind} : ${id}) ?`)) return;

      try {
        showToast('Suppression…', 'info');
        if (kind === 'note') { await FirestoreService.deleteNote(id); state.data.notes = state.data.notes.filter(d => d.id !== id); EventBus.emit('note:deleted', { noteId: id }); }
        else if (kind === 'link') { await FirestoreService.deleteLink(id); state.data.links = state.data.links.filter(d => d.id !== id); EventBus.emit('link:deleted', { linkId: id }); }
        else if (kind === 'shortcut') { await FirestoreService.deleteShortcut(id); state.data.shortcuts = state.data.shortcuts.filter(d => d.id !== id); }

        ['notes', 'links', 'shortcuts', 'users'].forEach(t => {
          const el = c.querySelector(`[data-count="${t}"]`);
          if (el) el.textContent = state.data[t].length;
        });

        showToast('Document supprimé.', 'success');
        renderTable();
      } catch (err) {
        console.error('[DB] delete failed:', err);
        showToast(`Suppression échouée : ${err.message}`, 'error');
      }
    });
  });
}

function formatDate(ts) {
  const ms = millis(ts);
  return ms ? new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}
function truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

/** Tear down. */
export function destroy() {
  state.container = null;
  state.data = { notes: [], links: [], shortcuts: [], users: [] };
  state.userMap = {};
  state.expandedId = null;
}
