/**
 * Fiches & Cloud — admin "Shares" app.
 *
 * The oversight side of folder sharing: every folder that carries a grant, who
 * can see it, and the ability to add or revoke recipients on the owner's
 * behalf. It also backfills the `directory` collection that non-admins use to
 * pick a recipient in the explorer.
 *
 * Grants live on the folder (`sharedWith: string[]`) and are inherited by the
 * whole subtree — `FirestoreService.setFolderShares()` re-propagates them.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, showToast, showModal, iconImg } from '../app.js';

const PAGE_SIZE = 10;

const state = {
  container: null,
  folders: [],
  notes: [],
  links: [],
  users: [],
  directory: [],
  filter: 'shared',   // 'shared' | 'all'
  query: '',
  page: 1,
  loading: false,
  syncing: false
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  container.classList.add('admin-container');
  state.page = 1;

  container.innerHTML = `
    <div class="admin-app">
      <div class="admin-app__header">
        <div class="admin-app__title">
          ${iconImg('share', { size: 24, alt: '' })}
          <h2>Partages</h2>
          <span class="badge badge--admin">Admin</span>
        </div>
        <div class="admin-app__actions">
          <button class="btn btn--secondary" id="ash-sync">${iconImg('group', { size: 16, alt: '' })}<span>Synchroniser l'annuaire</span></button>
          <button class="btn btn--secondary" id="ash-refresh">${iconImg('refresh', { size: 16, alt: '' })}<span>Rafraîchir</span></button>
        </div>
      </div>

      <div class="admin-app__toolbar">
        <select class="input select" id="ash-filter" aria-label="Filtrer les dossiers">
          <option value="shared">Dossiers partagés</option>
          <option value="all">Tous les dossiers</option>
        </select>

        <div class="search-field">
          ${iconImg('search', { size: 18, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="ash-search"
                 placeholder="Rechercher un dossier ou une personne…">
        </div>
      </div>

      <div class="admin-app__body" id="ash-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement des partages…</p></div>
      </div>

      <div class="pagination" id="ash-pagination" hidden>
        <span class="pagination__info" id="ash-page-info"></span>
        <div class="pagination__controls">
          <button class="btn btn--secondary" id="ash-prev">Précédent</button>
          <button class="btn btn--secondary" id="ash-next">Suivant</button>
        </div>
      </div>
    </div>
  `;

  const c = state.container;
  c.querySelector('#ash-refresh')?.addEventListener('click', () => load());
  c.querySelector('#ash-sync')?.addEventListener('click', syncDirectory);
  c.querySelector('#ash-filter')?.addEventListener('change', e => {
    state.filter = e.target.value;
    state.page = 1;
    renderRows();
  });
  c.querySelector('#ash-search')?.addEventListener('input', e => {
    state.query = e.target.value.trim().toLowerCase();
    state.page = 1;
    renderRows();
  });
  c.querySelector('#ash-prev')?.addEventListener('click', () => { state.page -= 1; renderRows(); });
  c.querySelector('#ash-next')?.addEventListener('click', () => { state.page += 1; renderRows(); });

  await load();
}

async function load() {
  const body = state.container?.querySelector('#ash-body');
  if (!body || state.loading) return;

  state.loading = true;
  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement des partages…</p></div>`;

  const failures = [];
  const safe = (label, fn) => Promise.resolve().then(fn).catch(err => {
    console.warn(`[Shares] ${label} failed:`, err.message);
    failures.push(label);
    return [];
  });

  try {
    const [folders, notes, links, users, directory] = await Promise.all([
      safe('dossiers', () => FirestoreService.getAllFolders()),
      safe('fiches', () => FirestoreService.getAllNotes()),
      safe('liens', () => FirestoreService.getAllLinks()),
      safe('utilisateurs', () => FirestoreService.getAllUsers()),
      safe('annuaire', () => FirestoreService.getDirectory())
    ]);

    state.folders = folders;
    state.notes = notes;
    state.links = links;
    state.users = users;
    state.directory = directory;

    if (failures.length) {
      showToast(`Données partielles (${[...new Set(failures)].join(', ')}). Vérifiez les règles Firestore.`, 'error');
    }
    renderRows();
  } catch (err) {
    console.error('[Shares] load failed:', err);
    body.innerHTML = `
      <div class="empty-state">
        ${iconImg('high-priority', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Chargement impossible</h3>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="ash-retry">Réessayer</button>
      </div>`;
    body.querySelector('#ash-retry')?.addEventListener('click', () => load());
  } finally {
    state.loading = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMap() {
  const map = new Map();
  state.users.forEach(u => map.set(u.id || u.uid, u));
  return map;
}

function ownerLabel(folder) {
  const owner = userMap().get(folder.uid);
  const name = owner?.displayName || owner?.email?.split('@')[0] || folder.ownerName || '';
  return name || shortUid(folder.uid);
}

function shortUid(uid) {
  return typeof uid === 'string' && uid.length > 10 ? `${uid.slice(0, 8)}…` : (uid || '—');
}

function recipients(folder) {
  return Array.isArray(folder.sharedWith) ? folder.sharedWith : [];
}

function labelFor(uid) {
  const u = userMap().get(uid);
  return u?.displayName || u?.email || uid;
}

function emailFor(uid) {
  return userMap().get(uid)?.email || '';
}

/** "Mes fichiers / Cours / Maths" style path built from the folder pool. */
function folderPath(folder) {
  const byId = new Map(state.folders.map(f => [f.id, f]));
  const parts = [];
  const guard = new Set();
  let cur = folder.parentId || null;
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const parent = byId.get(cur);
    parts.unshift(parent.name || 'Sans nom');
    cur = parent.parentId || null;
  }
  return parts;
}

/** Number of fiches + links directly inside a folder. */
function directCount(folderId) {
  return state.notes.filter(n => n.parentId === folderId).length
    + state.links.filter(l => l.parentId === folderId).length;
}

function matches(folder) {
  if (state.filter === 'shared' && recipients(folder).length === 0) return false;
  if (!state.query) return true;
  const haystack = [
    folder.name,
    ...folderPath(folder),
    ownerLabel(folder),
    ...recipients(folder).map(labelFor),
    ...recipients(folder).map(emailFor)
  ].join(' ').toLowerCase();
  return haystack.includes(state.query);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function renderRows() {
  const body = state.container?.querySelector('#ash-body');
  const pagination = state.container?.querySelector('#ash-pagination');
  const info = state.container?.querySelector('#ash-page-info');
  const prev = state.container?.querySelector('#ash-prev');
  const next = state.container?.querySelector('#ash-next');
  if (!body) return;

  const all = state.folders.filter(matches);
  const total = all.length;
  const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), maxPages);

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = all.slice(start, start + PAGE_SIZE);

  if (pagination) pagination.hidden = total <= PAGE_SIZE;
  if (info) info.textContent = total === 0 ? 'Aucun dossier' : `${start + 1}–${Math.min(start + PAGE_SIZE, total)} sur ${total}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= maxPages;

  if (total === 0) {
    body.innerHTML = state.filter === 'shared'
      ? `<div class="empty-state">
           ${iconImg('shared-folder', { size: 48, alt: '', className: 'empty-state__icon' })}
           <h3 class="empty-state__title">Aucun dossier partagé</h3>
           <p class="empty-state__description">Aucun utilisateur n'a encore partagé un dossier — ou aucun ne correspond à la recherche.</p>
         </div>`
      : `<div class="empty-state">
           ${iconImg('opened-folder', { size: 48, alt: '', className: 'empty-state__icon' })}
           <h3 class="empty-state__title">Aucun dossier</h3>
           <p class="empty-state__description">Aucun dossier ne correspond à la recherche.</p>
         </div>`;
    return;
  }

  const rows = pageRows.map(folder => {
    const path = folderPath(folder);
    const shared = recipients(folder);
    const count = directCount(folder.id);
    const chips = shared.length
      ? shared.map(uid => `<span class="share-chip" title="${escapeAttr(emailFor(uid) || uid)}">${escapeHtml(labelFor(uid))}</span>`).join(' ')
      : '<span class="table__cell--muted">Privé</span>';

    return `
      <tr class="table__row">
        <td class="table__cell table__cell--strong">
          <span class="shares-row__name">
            ${iconImg(shared.length ? 'shared-folder' : 'opened-folder', { size: 16, alt: '' })}
            <span>${escapeHtml(folder.name || 'Sans nom')}</span>
          </span>
          <span class="table__cell--muted">${path.length ? escapeHtml(path.join(' / ')) : 'Racine'}</span>
        </td>
        <td class="table__cell">${escapeHtml(ownerLabel(folder))}</td>
        <td class="table__cell"><span class="share-chips">${chips}</span></td>
        <td class="table__cell table__cell--muted">${count} élément${count === 1 ? '' : 's'}</td>
        <td class="table__cell table__cell--actions">
          <button type="button" class="btn btn--secondary" data-share="${escapeAttr(folder.id)}">
            ${iconImg('share', { size: 16, alt: '' })}<span>Gérer</span>
          </button>
        </td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead class="table__head">
          <tr>
            <th>Dossier</th>
            <th>Propriétaire</th>
            <th>Partagé avec</th>
            <th>Contenu direct</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  body.querySelectorAll('[data-share]').forEach(btn => {
    btn.addEventListener('click', () => {
      const folder = state.folders.find(f => f.id === btn.dataset.share);
      if (folder) openShareDialog(folder);
    });
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Drive-style recipient picker. Admins pick from the full `users` collection so
 * sharing works even when the `directory` has not been backfilled yet.
 */
function openShareDialog(folder) {
  if (!folder) return;

  const ownerAccount = userMap().get(folder.uid);
  const ownerName = ownerAccount?.displayName
    || ownerAccount?.email?.split('@')[0]
    || folder.ownerName
    || '';

  const current = new Set(recipients(folder));
  const accounts = state.users
    .filter(u => (u.id || u.uid) !== folder.uid)
    .map(u => ({
      uid: u.id || u.uid,
      name: u.displayName || u.email?.split('@')[0] || u.id || u.uid,
      email: u.email || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const row = u => `
    <label class="share-dialog__user" data-name="${escapeAttr(`${u.name} ${u.email}`.toLowerCase())}">
      <input type="checkbox" value="${escapeAttr(u.uid)}" ${current.has(u.uid) ? 'checked' : ''}>
      <span class="share-dialog__name">${escapeHtml(u.name)}</span>
      ${u.email ? `<span class="share-dialog__email">${escapeHtml(u.email)}</span>` : ''}
    </label>`;

  const orphans = [...current].filter(uid => !accounts.some(u => u.uid === uid));

  const wrap = document.createElement('div');
  wrap.className = 'dialog share-dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Partager « ${escapeHtml(folder.name || 'Sans nom')} »</h3>
    <p class="share-dialog__hint">Propriétaire : ${escapeHtml(ownerLabel(folder))}</p>

    ${accounts.length ? `
      <div class="share-dialog__search">
        ${iconImg('search', { size: 16, alt: '' })}
        <input type="text" class="input input--search" id="ashd-search" placeholder="Rechercher une personne…">
      </div>` : ''}

    <div class="share-dialog__list">
      ${[...orphans.map(uid => row({ uid, name: labelFor(uid), email: emailFor(uid) })), ...accounts.map(row)].join('')
        || '<p class="share-dialog__hint">Aucun autre compte.</p>'}
    </div>

    <p class="share-dialog__hint">
      Les personnes sélectionnées pourront consulter ce dossier et tout son contenu.
      Le propriétaire reste le seul à pouvoir le modifier.
    </p>

    <div class="form-actions">
      <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
      <button type="button" class="btn btn--primary" data-action="save">Enregistrer</button>
    </div>
  `;

  const { hide } = showModal(wrap);

  const search = wrap.querySelector('#ashd-search');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    wrap.querySelectorAll('.share-dialog__user').forEach(el => {
      el.hidden = Boolean(q) && !el.dataset.name.includes(q);
    });
  });

  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);

  wrap.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const picked = [...wrap.querySelectorAll('.share-dialog__list input[type="checkbox"]:checked')].map(c => c.value);
    try {
      showToast('Mise à jour du partage…', 'info');
      await FirestoreService.setFolderShares({
        folderId: folder.id,
        sharedWith: picked,
        ownerUid: folder.uid,
        ownerName
      });
      hide();
      EventBus.emit('share:updated', { folderId: folder.id, sharedWith: picked });
      showToast(picked.length ? `Partagé avec ${picked.length} personne(s).` : 'Partage retiré.', 'success');
      await load();
    } catch (err) {
      console.error('[Shares] save failed:', err);
      showToast(`Partage échoué : ${err.message}`, 'error');
    }
  });
}

/** Backfill `directory` from the full user profiles (accounts created before sharing). */
async function syncDirectory() {
  if (state.syncing) return;
  state.syncing = true;
  const btn = state.container?.querySelector('#ash-sync');
  if (btn) btn.disabled = true;

  try {
    const users = state.users.length ? state.users : await FirestoreService.getAllUsers();
    const { count } = await FirestoreService.syncDirectory(users);
    state.directory = await FirestoreService.getDirectory().catch(() => state.directory);
    showToast(`Annuaire synchronisé : ${count} compte(s).`, 'success');
  } catch (err) {
    console.error('[Shares] directory sync failed:', err);
    showToast(`Synchronisation échouée : ${err.message}`, 'error');
  } finally {
    state.syncing = false;
    if (btn) btn.disabled = false;
  }
}

/** Tear down. */
export function destroy() {
  state.container = null;
  state.folders = [];
  state.notes = [];
  state.links = [];
  state.users = [];
  state.directory = [];
  state.query = '';
  state.filter = 'shared';
  state.page = 1;
  state.loading = false;
  state.syncing = false;
}
