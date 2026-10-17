/**
 * Fiches & Cloud — admin "Users" app.
 *
 * Lists registered accounts, manages roles, browses any user's documents and
 * shows the recent document access log.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState, showToast, iconImg } from '../app.js';

const PAGE_SIZE = 12;

const state = {
  container: null,
  tab: 'users',      // users | documents | activity
  users: [],
  notes: [],
  links: [],
  logs: [],
  selectedUid: '',
  query: '',
  page: 1
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  container.classList.add('admin-container');

  const tab = (id, label) => `
    <button class="tab-btn ${state.tab === id ? 'tab-btn--active' : ''}" data-tab="${id}">${label}</button>`;

  container.innerHTML = `
    <div class="admin-app">
      <div class="admin-app__header">
        <div class="admin-app__title">
          ${iconImg('group', { size: 24, alt: '' })}
          <h2>Utilisateurs</h2>
          <span class="badge badge--admin">Admin</span>
        </div>
        <button class="btn btn--secondary" id="au-refresh">${iconImg('refresh', { size: 16, alt: '' })}<span>Rafraîchir</span></button>
      </div>

      <div class="admin-app__toolbar">
        <div class="tabs-row">
          ${tab('users', 'Comptes')}
          ${tab('documents', 'Documents')}
          ${tab('activity', "Journal d'accès")}
        </div>
        <div class="search-field" id="au-search-wrap">
          ${iconImg('search', { size: 16, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="au-search" placeholder="Filtrer…" value="${escapeAttr(state.query)}">
        </div>
      </div>

      <div class="admin-app__body" id="au-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement des utilisateurs…</p></div>
      </div>

      <div class="pagination" id="au-pagination">
        <span class="pagination__info" id="au-page-info">—</span>
        <div class="pagination__controls">
          <button class="btn btn--secondary btn--sm" id="au-prev">&laquo; Précédent</button>
          <button class="btn btn--secondary btn--sm" id="au-next">Suivant &raquo;</button>
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
      c.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b === btn));
      renderView();
    });
  });

  let timer = null;
  c.querySelector('#au-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    state.query = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => { state.page = 1; renderView(); }, 200);
  });

  c.querySelector('#au-refresh')?.addEventListener('click', loadAll);
  c.querySelector('#au-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page--; renderView(); } });
  c.querySelector('#au-next')?.addEventListener('click', () => { state.page++; renderView(); });
}

async function loadAll() {
  const body = state.container?.querySelector('#au-body');
  if (!body) return;
  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement des utilisateurs…</p></div>`;

  const safe = p => p.catch(err => { console.warn('[Users] query failed:', err); return []; });

  try {
    const [users, notes, links, logs] = await Promise.all([
      safe(FirestoreService.getAllUsers()),
      safe(FirestoreService.getAllNotes()),
      safe(FirestoreService.getAllLinks()),
      safe(FirestoreService.getAccessLogs({ limit: 100 }))
    ]);
    state.users = users;
    state.notes = notes;
    state.links = links;
    state.logs = logs;
    renderView();
  } catch (err) {
    console.error('[Users] load failed:', err);
    body.innerHTML = `<div class="empty-state"><p class="empty-state__title">Chargement impossible</p><p class="empty-state__description">${escapeHtml(err.message)}</p></div>`;
  }
}

function renderView() {
  if (state.tab === 'users') renderUsers();
  else if (state.tab === 'documents') renderDocuments();
  else renderActivity();
}

function paged(rows) {
  const max = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), max);
  const start = (state.page - 1) * PAGE_SIZE;
  setPagination(rows.length, start);
  return rows.slice(start, start + PAGE_SIZE);
}

function setPagination(total, start) {
  const c = state.container;
  const info = c.querySelector('#au-page-info');
  const prev = c.querySelector('#au-prev');
  const next = c.querySelector('#au-next');
  const max = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (info) info.textContent = total === 0 ? 'Aucun résultat' : `${start + 1}–${Math.min(start + PAGE_SIZE, total)} sur ${total}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= max;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function renderUsers() {
  const body = state.container.querySelector('#au-body');
  const q = state.query;

  const filtered = state.users.filter(u => !q ||
    [u.email, u.displayName, u.role].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));

  const rows = paged(filtered);
  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state"><p class="empty-state__title">Aucun utilisateur</p><p class="empty-state__description">Aucun compte ne correspond.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr class="table__head">
        <th>Utilisateur</th><th>Rôle</th><th>Stockage</th><th>Dernière connexion</th><th class="table__cell--actions">Actions</th>
      </tr></thead>
      <tbody>${rows.map(u => {
        const id = u.id || u.uid;
        const pct = u.quotaLimit ? Math.round(((u.quotaUsed || 0) / u.quotaLimit) * 100) : 0;
        return `
        <tr class="table__row" data-id="${id}">
          <td class="table__cell">
            <div class="user-cell">
              <span class="user-cell__avatar">${escapeHtml((u.displayName || u.email || '?').charAt(0).toUpperCase())}</span>
              <div class="user-cell__info">
                <span class="user-cell__name">${escapeHtml(u.displayName || 'Sans nom')}</span>
                <span class="user-cell__email">${escapeHtml(u.email || '—')}</span>
              </div>
            </div>
          </td>
          <td class="table__cell">
            <select class="input select role-select" data-uid="${id}">
              <option value="user" ${u.role !== 'admin' ? 'selected' : ''}>user</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
          </td>
          <td class="table__cell">
            <div class="mini-bar"><div class="mini-bar__fill" style="width:${pct}%"></div></div>
            <span class="table__cell--muted">${(u.quotaUsed || 0).toLocaleString('fr-FR')} car. (${pct}%)</span>
          </td>
          <td class="table__cell table__cell--muted">${formatDate(u.lastLogin)}</td>
          <td class="table__cell table__cell--actions">
            <button class="btn btn--sm btn-view-docs" data-uid="${id}">Documents</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table></div>`;

  body.querySelectorAll('.role-select').forEach(sel => {
    sel.addEventListener('change', () => changeRole(sel.dataset.uid, sel.value, sel));
  });
  body.querySelectorAll('.btn-view-docs').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedUid = btn.dataset.uid;
      state.tab = 'documents';
      state.page = 1;
      state.container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b.dataset.tab === 'documents'));
      renderView();
    });
  });
}

async function changeRole(uid, role, select) {
  const previous = state.users.find(u => (u.id || u.uid) === uid)?.role || 'user';
  if (!confirm(`Changer le rôle de cet utilisateur en « ${role} » ?`)) {
    select.value = previous;
    return;
  }
  try {
    await FirestoreService.updateUserRole(uid, role);
    const user = state.users.find(u => (u.id || u.uid) === uid);
    if (user) user.role = role;
    if (AppState.user?.uid === uid) AppState.isAdmin = role === 'admin';
    EventBus.emit('user:roleChanged', { uid, role });
    showToast(`Rôle mis à jour : ${role}.`, 'success');
  } catch (err) {
    console.error('[Users] role change failed:', err);
    select.value = previous;
    showToast(`Échec : ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Documents (per user)
// ---------------------------------------------------------------------------

function renderDocuments() {
  const c = state.container;
  const body = c.querySelector('#au-body');

  const userOptions = state.users.map(u => {
    const id = u.id || u.uid;
    return `<option value="${id}" ${state.selectedUid === id ? 'selected' : ''}>${escapeHtml(u.displayName || u.email || id)}</option>`;
  }).join('');

  const uid = state.selectedUid || (state.users[0] && (state.users[0].id || state.users[0].uid)) || '';
  state.selectedUid = uid;

  const userNotes = state.notes.filter(n => n.uid === uid);
  const userLinks = state.links.filter(l => l.uid === uid);
  const totalChars = userNotes.reduce((sum, n) => sum + (n.charCount ?? (n.content || '').length), 0);

  const chips = `
    <div class="stat-chips">
      <span class="stat-chip"><strong>${userNotes.length}</strong> fiches</span>
      <span class="stat-chip"><strong>${userLinks.length}</strong> liens</span>
      <span class="stat-chip"><strong>${totalChars.toLocaleString('fr-FR')}</strong> caractères</span>
    </div>`;

  const notesTable = userNotes.length === 0
    ? '<p class="table__cell--muted">Aucune fiche.</p>'
    : `<div class="table-wrap"><table class="table">
        <thead><tr class="table__head"><th>Titre</th><th>Matière</th><th>Car.</th><th>Publique</th><th>Modifiée</th><th class="table__cell--actions"></th></tr></thead>
        <tbody>${userNotes.map(n => `
          <tr class="table__row">
            <td class="table__cell table__cell--strong">${escapeHtml(truncate(n.title || 'Sans titre', 32))}</td>
            <td class="table__cell"><span class="badge badge--subject">${escapeHtml(n.subject || 'Général')}</span></td>
            <td class="table__cell">${(n.charCount ?? (n.content || '').length).toLocaleString('fr-FR')}</td>
            <td class="table__cell">${n.isPublic ? '<span class="badge badge--public">Oui</span>' : '—'}</td>
            <td class="table__cell table__cell--muted">${formatDate(n.updatedAt)}</td>
            <td class="table__cell table__cell--actions">
              <button class="btn btn--sm btn-open-note" data-id="${n.id}">Ouvrir</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;

  const linksTable = userLinks.length === 0
    ? '<p class="table__cell--muted">Aucun lien.</p>'
    : `<div class="table-wrap"><table class="table">
        <thead><tr class="table__head"><th>Titre</th><th>URL</th><th>Matière</th></tr></thead>
        <tbody>${userLinks.map(l => `
          <tr class="table__row">
            <td class="table__cell table__cell--strong">${escapeHtml(truncate(l.title || 'Sans titre', 28))}</td>
            <td class="table__cell"><a href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncate(l.url, 34))}</a></td>
            <td class="table__cell"><span class="badge badge--subject">${escapeHtml(l.subject || 'Général')}</span></td>
          </tr>`).join('')}
        </tbody></table></div>`;

  body.innerHTML = `
    <div class="admin-app__selector">
      <label class="form-label" for="au-user-select">Utilisateur</label>
      <select class="input select" id="au-user-select">${userOptions || '<option value="">Aucun utilisateur</option>'}</select>
    </div>
    ${chips}
    <div class="admin-app__section"><h3>Fiches</h3>${notesTable}</div>
    <div class="admin-app__section"><h3>Liens</h3>${linksTable}</div>
  `;

  body.querySelector('#au-user-select')?.addEventListener('change', e => {
    state.selectedUid = e.target.value;
    state.page = 1;
    renderView();
  });
  body.querySelectorAll('.btn-open-note').forEach(btn => {
    btn.addEventListener('click', () => EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId: btn.dataset.id } }));
  });

  setPagination(0, 0);
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

function renderActivity() {
  const body = state.container.querySelector('#au-body');
  const q = state.query;

  const filtered = state.logs.filter(l => !q ||
    [l.action, l.documentType, l.uid, l.documentId].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));

  const rows = paged(filtered);
  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state"><p class="empty-state__title">Journal vide</p><p class="empty-state__description">Aucune activité enregistrée.</p></div>`;
    return;
  }

  const userName = uid => {
    const u = state.users.find(x => (x.id || x.uid) === uid);
    return u ? (u.displayName || u.email) : uid;
  };

  body.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr class="table__head"><th>Date</th><th>Utilisateur</th><th>Action</th><th>Type</th><th>Document</th></tr></thead>
      <tbody>${rows.map(l => `
        <tr class="table__row">
          <td class="table__cell table__cell--muted">${formatDateTime(l.timestamp)}</td>
          <td class="table__cell">${escapeHtml(userName(l.uid) || '—')}</td>
          <td class="table__cell"><span class="badge badge--action badge--action-${escapeAttr(l.action || 'view')}">${escapeHtml(l.action || 'view')}</span></td>
          <td class="table__cell">${escapeHtml(l.documentType || 'note')}</td>
          <td class="table__cell table__cell--muted"><code>${escapeHtml(truncate(l.documentId || '—', 16))}</code></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function formatDate(ts) {
  const ms = millis(ts);
  return ms ? new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
function formatDateTime(ts) {
  const ms = millis(ts);
  return ms ? new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
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
  state.users = []; state.notes = []; state.links = []; state.logs = [];
  state.selectedUid = '';
}
