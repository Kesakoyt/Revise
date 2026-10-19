/**
 * Fiches & Cloud — Admin "Fichiers publics" browser.
 *
 * A file-explorer-style view — icon + name, folders, breadcrumb, Windows-style
 * Properties dialog, right-click menu — of **everybody's public fiches and
 * links**, embedded in the admin "Base de données" panel.
 *
 * Admins may open, rename, move, edit, unpublish and delete any of it: the
 * Firestore rules grant `isAdmin()` write access to `notes`, `links` and
 * `folders`. Only public fiches/links are listed; folders are kept when they
 * (or something nested inside them) hold public content, so every branch you
 * can open leads somewhere.
 *
 * Deliberately NOT built on the `file-explorer` module — that one is a
 * singleton bound to the signed-in user's own tree, and the workspace can host
 * both panels side by side.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { EventBus, AppState, showToast, showModal, iconImg } from '../app.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';

const ICON_FOLDER = 'opened-folder';
const ICON_GRID = 'thumbnails';

const state = {
  container: null,
  currentFolderId: null, // null = root
  view: 'list',          // 'list' | 'grid'
  sort: 'date-desc',
  query: '',
  folders: [],   // folders that lead to public content
  allFolders: [], // every folder (move targets, cascade deletes, stats)
  notes: [],     // public fiches (what the browser shows)
  links: [],     // public links (what the browser shows)
  allNotes: [],  // every fiche — folder deletes must not orphan private ones
  allLinks: [],  // every link
  subjects: [],
  userMap: {},
  onChanged: null,
  selection: null
};

/**
 * Render (or re-render) the browser inside `container`.
 * @param {HTMLElement} container
 * @param {{folders?:Array, notes?:Array, links?:Array, userMap?:Object, query?:string, onChanged?:Function}} data
 */
export function render(container, data = {}) {
  state.container = container;

  applyData(data);

  container.innerHTML = `
    <div class="public-files">
      <div class="public-files__bar">
        <nav class="public-files__breadcrumb" id="pf-breadcrumb" aria-label="Chemin"></nav>
        <span class="public-files__count" id="pf-count"></span>
        <div class="view-toggle">
          <button class="view-toggle__btn ${state.view === 'list' ? 'view-toggle__btn--active' : ''}" id="pf-view-list" title="Liste" aria-label="Vue liste">
            ${iconImg('list', { size: 18, alt: '' })}
          </button>
          <button class="view-toggle__btn ${state.view === 'grid' ? 'view-toggle__btn--active' : ''}" id="pf-view-grid" title="Grille" aria-label="Vue grille">
            ${iconImg(ICON_GRID, { size: 18, alt: '' })}
          </button>
        </div>
      </div>

      <div class="public-files__body" id="pf-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement…</p></div>
      </div>
    </div>
  `;

  bind();
  renderBreadcrumb();
  renderBody();
}

/** Feed fresh collections in; navigation survives re-renders. */
function applyData(data) {
  state.allFolders = data.folders || [];
  state.allNotes = data.notes || [];
  state.allLinks = data.links || [];

  const byId = new Map(state.allFolders.map(f => [f.id, f]));
  const keep = item => item.isPublic === true;

  // A fiche/link whose folder vanished or isn't loaded still has to be
  // reachable — park it at the root rather than making it invisible.
  const normalize = item => ({
    ...item,
    parentId: item.parentId && byId.has(item.parentId) ? item.parentId : null
  });

  state.notes = state.allNotes.filter(keep).map(normalize);
  state.links = state.allLinks.filter(keep).map(normalize);
  state.folders = visibleFolders(state.allFolders, state.notes, state.links);

  state.userMap = data.userMap || {};
  state.query = (data.query || '').toLowerCase();
  state.onChanged = data.onChanged || null;

  const subjects = new Set();
  state.notes.forEach(n => { if (n.subject?.trim()) subjects.add(n.subject.trim()); });
  state.links.forEach(l => { if (l.subject?.trim()) subjects.add(l.subject.trim()); });
  state.subjects = [...subjects].sort();

  // The folder we were in may have lost its public content (or been deleted).
  if (state.currentFolderId && !state.folders.some(f => f.id === state.currentFolderId)) {
    state.currentFolderId = null;
  }
}

/** Folders worth showing: every one that holds a public item, plus its ancestors. */
function visibleFolders(allFolders, notes, links) {
  const byId = new Map(allFolders.map(f => [f.id, f]));
  const keep = new Set();

  const markBranch = id => {
    let guard = 0;
    while (id && byId.has(id) && !keep.has(id) && guard++ < 1000) {
      keep.add(id);
      id = byId.get(id).parentId || null;
    }
  };

  notes.forEach(n => n.parentId && markBranch(n.parentId));
  links.forEach(l => l.parentId && markBranch(l.parentId));

  return allFolders.filter(f => keep.has(f.id));
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function parentOf(item) { return item.parentId || null; }

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function formatFullDate(ts) {
  const ms = millis(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Ask the admin panel to re-read Firestore (data changed under it). */
function notify() {
  try { state.onChanged?.(); } catch (err) { console.warn('[PublicFiles] onChanged failed:', err); }
}

function logAccess(documentId, documentType, action) {
  const uid = AppState.user?.uid;
  if (uid) FirestoreService.logAccess({ uid, documentId, documentType, action }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Ancestor folders from root down to `folderId`. */
function folderPath(folderId) {
  const byId = new Map(state.folders.map(f => [f.id, f]));
  const path = [];
  const guard = new Set();
  let cur = folderId;
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const folder = byId.get(cur);
    path.unshift(folder);
    cur = parentOf(folder);
  }
  return path;
}

function renderBreadcrumb() {
  const nav = state.container?.querySelector('#pf-breadcrumb');
  if (!nav) return;

  const path = folderPath(state.currentFolderId);
  const parts = [
    `<button type="button" class="breadcrumb__crumb" data-folder="">
      ${iconImg(ICON_FOLDER, { size: 15, alt: '' })}<span>Fichiers publics</span>
    </button>`
  ];

  path.forEach(folder => {
    parts.push('<span class="breadcrumb__sep" aria-hidden="true">&rsaquo;</span>');
    parts.push(`<button type="button" class="breadcrumb__crumb" data-folder="${escapeAttr(folder.id)}">${escapeHtml(folder.name || 'Sans nom')}</button>`);
  });

  nav.innerHTML = `<div class="breadcrumb">${parts.join('')}</div>`;
  nav.querySelectorAll('[data-folder]').forEach(btn => {
    btn.addEventListener('click', () => enterFolder(btn.dataset.folder || null));
  });
}

function enterFolder(folderId) {
  state.currentFolderId = folderId || null;
  state.selection = null;
  renderBreadcrumb();
  renderBody();
  state.container?.querySelector('#pf-body')?.scrollTo?.({ top: 0 });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function childrenOf(folderId) {
  return {
    folders: state.folders.filter(f => parentOf(f) === folderId),
    notes: state.notes.filter(n => parentOf(n) === folderId),
    links: state.links.filter(l => parentOf(l) === folderId)
  };
}

function matchesQuery(obj, keys) {
  if (!state.query) return true;
  return keys.some(k => String(obj[k] || '').toLowerCase().includes(state.query));
}

function sortEntries(entries) {
  const [field, dir] = state.sort.split('-');
  const sign = dir === 'desc' ? -1 : 1;
  const value = entry => {
    if (field === 'title') return (entry.data.title || '').toLowerCase();
    if (field === 'subject') return (entry.data.subject || '').toLowerCase();
    return millis(entry.data.updatedAt || entry.data.createdAt);
  };
  return [...entries].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const cmp = typeof x === 'string' ? x.localeCompare(y, 'fr') : (x - y);
    if (cmp !== 0) return sign * cmp;
    return String(a.data.title || '').localeCompare(String(b.data.title || ''), 'fr');
  });
}

function renderBody() {
  const body = state.container?.querySelector('#pf-body');
  if (!body) return;

  const { folders, notes, links } = childrenOf(state.currentFolderId);

  const shownFolders = folders
    .filter(f => matchesQuery(f, ['name']))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));

  let files = [
    ...notes.filter(n => matchesQuery(n, ['title', 'subject', 'topic', 'content']))
      .map(data => ({ kind: 'note', id: data.id, data })),
    ...links.filter(l => matchesQuery(l, ['title', 'url', 'description', 'subject']))
      .map(data => ({ kind: 'link', id: data.id, data }))
  ];
  files = sortEntries(files);

  state.selection = null;

  const count = state.container?.querySelector('#pf-count');
  if (count) {
    const total = files.length + shownFolders.length;
    count.textContent = `${total} élément${total === 1 ? '' : 's'}`;
  }

  if (shownFolders.length === 0 && files.length === 0) {
    body.innerHTML = emptyStateHtml();
    return;
  }

  if (state.view === 'grid') {
    body.innerHTML = `<div class="file-grid">
      ${shownFolders.map(folderCard).join('')}
      ${files.map(entryCard).join('')}
    </div>`;
  } else {
    body.innerHTML = `<div class="file-list">
      ${shownFolders.map(folderRow).join('')}
      ${files.map(entryRow).join('')}
    </div>`;
  }
}

function emptyStateHtml() {
  const searching = Boolean(state.query);
  const inFolder = Boolean(state.currentFolderId);

  if (searching) {
    return `
      <div class="empty-state">
        ${iconImg('search', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Aucun résultat</h3>
        <p class="empty-state__description">Aucun contenu public ne correspond à cette recherche.</p>
      </div>`;
  }

  return `
    <div class="empty-state">
      ${iconImg(inFolder ? ICON_FOLDER : 'document', { size: 48, alt: '', className: 'empty-state__icon' })}
      <h3 class="empty-state__title">${inFolder ? 'Dossier vide' : 'Aucun contenu public'}</h3>
      <p class="empty-state__description">${
        inFolder
          ? 'Aucune fiche ni lien public dans ce dossier.'
          : 'Aucun utilisateur n’a encore rendu de fiche ou de lien public.'
      }</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Row / card renderers (icon + name only)
// ---------------------------------------------------------------------------

function itemAttrs(kind, id) {
  return `data-kind="${kind}" data-id="${escapeAttr(id)}" tabindex="0" role="button"`;
}

function propsBtn(kind, id) {
  return `<button type="button" class="btn btn--icon btn-props" title="Propriétés" aria-label="Propriétés" data-props-kind="${escapeAttr(kind)}" data-props-id="${escapeAttr(id)}">
    ${iconImg('info', { size: 16, alt: '' })}
  </button>`;
}

function folderRow(folder) {
  return `
    <div class="file-item file-item--folder" ${itemAttrs('folder', folder.id)}>
      ${iconImg(ICON_FOLDER, { size: 22, alt: '', className: 'file-item__icon' })}
      <span class="file-item__title">${escapeHtml(folder.name || 'Sans nom')}</span>
      <div class="file-item__actions">${propsBtn('folder', folder.id)}</div>
    </div>`;
}

function noteRow(note) {
  return `
    <div class="file-item" ${itemAttrs('note', note.id)}>
      ${iconImg('document', { size: 20, alt: '', className: 'file-item__icon' })}
      <span class="file-item__title">${escapeHtml(note.title || 'Sans titre')}</span>
      <div class="file-item__actions">${propsBtn('note', note.id)}</div>
    </div>`;
}

function linkRow(link) {
  return `
    <div class="file-item" ${itemAttrs('link', link.id)}>
      ${iconImg('link', { size: 20, alt: '', className: 'file-item__icon' })}
      <span class="file-item__title">${escapeHtml(link.title || domainOf(link.url) || 'Sans titre')}</span>
      <div class="file-item__actions">${propsBtn('link', link.id)}</div>
    </div>`;
}

function folderCard(folder) {
  return `
    <article class="file-card file-card--folder" ${itemAttrs('folder', folder.id)}>
      <div class="file-card__icon">${iconImg(ICON_FOLDER, { size: 48, alt: '' })}</div>
      <div class="file-card__title">${escapeHtml(folder.name || 'Sans nom')}</div>
      <div class="file-card__actions">${propsBtn('folder', folder.id)}</div>
    </article>`;
}

function noteCard(note) {
  return `
    <article class="file-card" ${itemAttrs('note', note.id)}>
      <div class="file-card__icon">${iconImg('document', { size: 48, alt: '' })}</div>
      <div class="file-card__title">${escapeHtml(note.title || 'Sans titre')}</div>
      <div class="file-card__actions">${propsBtn('note', note.id)}</div>
    </article>`;
}

function linkCard(link) {
  return `
    <article class="file-card" ${itemAttrs('link', link.id)}>
      <div class="file-card__icon">${iconImg('link', { size: 48, alt: '' })}</div>
      <div class="file-card__title">${escapeHtml(link.title || domainOf(link.url) || 'Sans titre')}</div>
      <div class="file-card__actions">${propsBtn('link', link.id)}</div>
    </article>`;
}

function entryRow(entry) { return entry.kind === 'note' ? noteRow(entry.data) : linkRow(entry.data); }
function entryCard(entry) { return entry.kind === 'note' ? noteCard(entry.data) : linkCard(entry.data); }

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bind() {
  const c = state.container;
  if (!c) return;

  c.querySelector('#pf-view-list')?.addEventListener('click', () => setView('list'));
  c.querySelector('#pf-view-grid')?.addEventListener('click', () => setView('grid'));

  const body = c.querySelector('#pf-body');
  if (!body) return;

  body.addEventListener('click', e => {
    const propsEl = e.target.closest('.btn-props');
    if (propsEl) {
      e.stopPropagation();
      const kind = propsEl.dataset.propsKind;
      const id = propsEl.dataset.propsId;
      if (kind && id) openPropertiesDialog(kind, findItem(kind, id));
      return;
    }
    const item = e.target.closest('[data-kind][data-id]');
    if (!item) { setSelection(null); return; }
    activate(item.dataset.kind, item.dataset.id);
  });

  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return;
    const item = e.target.closest('[data-kind][data-id]');
    if (!item) return;
    e.preventDefault();
    activate(item.dataset.kind, item.dataset.id);
  });

  body.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const item = e.target.closest('[data-kind][data-id]');
    if (item) {
      const sel = { kind: item.dataset.kind, id: item.dataset.id };
      setSelection(sel);
      showContextMenu(e.clientX, e.clientY, itemMenu(sel));
      return;
    }
    setSelection(null);
    showContextMenu(e.clientX, e.clientY, backgroundMenuItems());
  });
}

function setView(view) {
  state.view = view;
  const list = state.container?.querySelector('#pf-view-list');
  const grid = state.container?.querySelector('#pf-view-grid');
  list?.classList.toggle('view-toggle__btn--active', view === 'list');
  grid?.classList.toggle('view-toggle__btn--active', view === 'grid');
  renderBody();
}

function setSelection(sel) {
  state.selection = sel;
  state.container?.querySelectorAll('[data-kind][data-id]').forEach(el => {
    const on = sel && el.dataset.kind === sel.kind && el.dataset.id === sel.id;
    if (el.classList.contains('file-item')) el.classList.toggle('file-item--selected', on);
    if (el.classList.contains('file-card')) el.classList.toggle('file-card--selected', on);
  });
}

function findItem(kind, id) {
  if (kind === 'folder') return state.folders.find(f => f.id === id) || null;
  if (kind === 'note') return state.notes.find(n => n.id === id) || null;
  return state.links.find(l => l.id === id) || null;
}

function activate(kind, id) {
  if (kind === 'folder') { enterFolder(id); return; }
  if (kind === 'note') {
    EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId: id } });
    return;
  }
  const link = findItem('link', id);
  if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

function backgroundMenuItems() {
  const viewSubmenu = [
    { label: 'Liste', icon: 'list', checked: state.view === 'list', onSelect: () => setView('list') },
    { label: 'Grille', icon: ICON_GRID, checked: state.view === 'grid', onSelect: () => setView('grid') }
  ];
  const sortSubmenu = [
    { label: 'Plus récents', checked: state.sort === 'date-desc', onSelect: () => setSort('date-desc') },
    { label: 'Plus anciens', checked: state.sort === 'date-asc', onSelect: () => setSort('date-asc') },
    { label: 'Nom (A→Z)', checked: state.sort === 'title-asc', onSelect: () => setSort('title-asc') },
    { label: 'Nom (Z→A)', checked: state.sort === 'title-desc', onSelect: () => setSort('title-desc') }
  ];
  return [
    { label: 'Rafraîchir', icon: 'refresh', onSelect: () => { notify(); showToast('Liste rafraîchie.', 'info'); } },
    { separator: true },
    { label: 'Affichage', icon: ICON_GRID, submenu: viewSubmenu },
    { label: 'Trier par', icon: 'sorting-arrows', submenu: sortSubmenu }
  ];
}

function itemMenu(sel) {
  if (sel.kind === 'folder') return folderMenuItems(findItem('folder', sel.id));
  if (sel.kind === 'note') return noteMenuItems(findItem('note', sel.id));
  return linkMenuItems(findItem('link', sel.id));
}

function folderMenuItems(folder) {
  if (!folder) return [];
  return [
    { label: 'Ouvrir', icon: ICON_FOLDER, onSelect: () => enterFolder(folder.id) },
    { label: 'Renommer', icon: 'edit', onSelect: () => renameFolder(folder) },
    { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('folder', folder) },
    { separator: true },
    { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteFolder(folder) },
    { separator: true },
    { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('folder', folder) }
  ];
}

function noteMenuItems(note) {
  if (!note) return [];
  return [
    { label: 'Ouvrir', icon: 'document', onSelect: () => activate('note', note.id) },
    { label: 'Renommer', icon: 'edit', onSelect: () => renameNote(note) },
    { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('note', note) },
    { label: 'Copier le titre', icon: 'copy', onSelect: () => copyText(note.title || 'Sans titre', 'Titre copié.') },
    { separator: true },
    { label: 'Rendre privée', icon: 'lock', onSelect: () => setNotePublic(note, false) },
    { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteNote(note.id) },
    { separator: true },
    { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('note', note) }
  ];
}

function linkMenuItems(link) {
  if (!link) return [];
  return [
    { label: 'Ouvrir dans un onglet', icon: 'external-link', onSelect: () => window.open(link.url, '_blank', 'noopener,noreferrer') },
    { label: 'Copier l’URL', icon: 'copy', onSelect: () => copyText(link.url, 'URL copiée.') },
    { label: 'Modifier', icon: 'edit', onSelect: () => openLinkDialog(link) },
    { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('link', link) },
    { separator: true },
    { label: 'Rendre privé', icon: 'lock', onSelect: () => setLinkPublic(link, false) },
    { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteLink(link.id) },
    { separator: true },
    { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('link', link) }
  ];
}

function setSort(sort) {
  state.sort = sort;
  renderBody();
}

function copyText(text, successMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text || '')).then(
      () => { if (successMsg) showToast(successMsg, 'success'); },
      () => showToast('Copie impossible.', 'error')
    );
  } else {
    showToast('Clipboard non disponible.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function renameNote(note) {
  openTextDialog({
    title: 'Renommer la fiche',
    label: 'Nom de la fiche',
    value: note.title || '',
    onSave: async name => {
      await FirestoreService.updateNote(note.id, { title: name });
      logAccess(note.id, 'note', 'edit');
      EventBus.emit('note:saved', { noteId: note.id });
      showToast('Fiche renommée.', 'success');
      notify();
    }
  });
}

function renameFolder(folder) {
  openTextDialog({
    title: 'Renommer le dossier',
    label: 'Nom du dossier',
    value: folder.name || '',
    onSave: async name => {
      await FirestoreService.updateFolder(folder.id, { name });
      logAccess(folder.id, 'folder', 'edit');
      showToast('Dossier renommé.', 'success');
      notify();
    }
  });
}

async function setNotePublic(note, isPublic) {
  try {
    await FirestoreService.updateNote(note.id, { isPublic });
    logAccess(note.id, 'note', 'edit');
    EventBus.emit('note:saved', { noteId: note.id });
    showToast(isPublic ? 'Fiche rendue publique.' : 'Fiche rendue privée.', 'success');
    notify();
  } catch (err) {
    console.error('[PublicFiles] toggle note visibility failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

async function setLinkPublic(link, isPublic) {
  try {
    await FirestoreService.updateLink(link.id, { isPublic });
    logAccess(link.id, 'link', 'edit');
    EventBus.emit('link:saved', { linkId: link.id });
    showToast(isPublic ? 'Lien rendu public.' : 'Lien rendu privé.', 'success');
    notify();
  } catch (err) {
    console.error('[PublicFiles] toggle link visibility failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

/** Quota belongs to the file's owner, not to the admin pressing the button. */
async function repairOwnerQuota(ownerUid) {
  if (!ownerUid) return;
  try {
    const quota = await QuotaManager.recalculateQuota(ownerUid);
    EventBus.emit('quota:updated', quota);
  } catch (err) {
    console.warn('[PublicFiles] quota recalculation failed:', err);
  }
}

async function deleteNote(noteId) {
  const note = findItem('note', noteId);
  if (!confirm(`Supprimer définitivement « ${note?.title || 'cette fiche'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    await FirestoreService.deleteNote(noteId);
    logAccess(noteId, 'note', 'delete');
    EventBus.emit('note:deleted', { noteId });
    await repairOwnerQuota(note?.uid);
    showToast('Fiche supprimée.', 'success');
    notify();
  } catch (err) {
    console.error('[PublicFiles] delete note failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

async function deleteLink(linkId) {
  const link = findItem('link', linkId);
  if (!confirm(`Supprimer « ${link?.title || 'ce lien'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    await FirestoreService.deleteLink(linkId);
    logAccess(linkId, 'link', 'delete');
    EventBus.emit('link:deleted', { linkId });
    showToast('Lien supprimé.', 'success');
    notify();
  } catch (err) {
    console.error('[PublicFiles] delete link failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

/** Ids of every folder nested (directly or not) inside `folderId`. */
function descendantIds(folderId, list = state.allFolders) {
  const ids = new Set();
  const walk = id => {
    list.forEach(f => {
      if (parentOf(f) === id && !ids.has(f.id)) { ids.add(f.id); walk(f.id); }
    });
  };
  walk(folderId);
  return ids;
}

async function deleteFolder(folder) {
  const ids = new Set([folder.id, ...descendantIds(folder.id)]);
  const folders = state.allFolders.filter(f => ids.has(f.id));
  // Cascade over *every* fiche/link inside, public or not — leaving private
  // ones behind would orphan them on a folder that no longer exists.
  const notes = state.allNotes.filter(n => ids.has(n.parentId));
  const links = state.allLinks.filter(l => ids.has(l.parentId));

  const parts = [`${folders.length} dossier${folders.length === 1 ? '' : 's'}`];
  if (notes.length) parts.push(`${notes.length} fiche${notes.length === 1 ? '' : 's'}`);
  if (links.length) parts.push(`${links.length} lien${links.length === 1 ? '' : 's'}`);
  if (!confirm(`Supprimer « ${folder.name} » et tout son contenu (${parts.join(', ')}) ? Action définitive.`)) return;

  try {
    showToast('Suppression…', 'info');
    await Promise.all([
      ...folders.map(f => FirestoreService.deleteFolder(f.id)),
      ...notes.map(n => FirestoreService.deleteNote(n.id)),
      ...links.map(l => FirestoreService.deleteLink(l.id))
    ]);

    folders.forEach(f => logAccess(f.id, 'folder', 'delete'));
    notes.forEach(n => logAccess(n.id, 'note', 'delete'));
    links.forEach(l => logAccess(l.id, 'link', 'delete'));

    if (notes.length) {
      // Every affected fiche may belong to a different user — repair each quota.
      const owners = [...new Set(notes.map(n => n.uid).filter(Boolean))];
      await Promise.all(owners.map(repairOwnerQuota));
    }

    if (state.currentFolderId && ids.has(state.currentFolderId)) state.currentFolderId = null;
    if (notes.length) EventBus.emit('note:deleted', { folderId: folder.id });
    if (links.length) EventBus.emit('link:deleted', { folderId: folder.id });
    showToast('Dossier supprimé.', 'success');
    notify();
  } catch (err) {
    console.error('[PublicFiles] delete folder failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

async function moveEntry(kind, id, destinationId) {
  if (kind === 'folder') await FirestoreService.updateFolder(id, { parentId: destinationId });
  else if (kind === 'note') await FirestoreService.updateNote(id, { parentId: destinationId });
  else await FirestoreService.updateLink(id, { parentId: destinationId });
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Generic single-field text dialog (folder/note rename). */
function openTextDialog({ title, label, value = '', onSave }) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">${escapeHtml(title)}</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-name">${escapeHtml(label)}</label>
        <input class="input" type="text" id="pf-dlg-name" maxlength="60" required>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Enregistrer</button>
      </div>
    </form>
  `;
  const input = wrap.querySelector('#pf-dlg-name');
  input.value = value;
  const { hide } = showModal(wrap);
  setTimeout(() => { input.focus(); input.select(); }, 30);
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);
  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { showToast('Le nom ne peut pas être vide.', 'error'); input.focus(); return; }
    try {
      await onSave(name);
      hide();
    } catch (err) {
      console.error('[PublicFiles] dialog save failed:', err);
      showToast(`Échec : ${err.message}`, 'error');
    }
  });
}

function openLinkDialog(link) {
  if (!link) return;
  const uid = AppState.user?.uid;

  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Modifier le lien</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-url">URL <span class="required">*</span></label>
        <input class="input" type="url" id="pf-dlg-url" placeholder="https://exemple.fr/article" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-title">Titre <span class="required">*</span></label>
        <input class="input" type="text" id="pf-dlg-title" placeholder="Nom de la ressource" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-subject">Matière</label>
        <input class="input" type="text" id="pf-dlg-subject" list="pf-dlg-subjects" placeholder="ex : Informatique">
        <datalist id="pf-dlg-subjects">${state.subjects.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-desc">Description (facultatif)</label>
        <textarea class="textarea" id="pf-dlg-desc" rows="2" placeholder="Résumé ou note personnelle…"></textarea>
      </div>
      <label class="toggle" title="Visible dans les fichiers publics">
        <input type="checkbox" class="toggle__input" id="pf-dlg-public">
        <span class="toggle__slider"></span>
        <span class="toggle__label">Public</span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">${iconImg('save', { size: 16, alt: '' })}<span>Mettre à jour</span></button>
      </div>
    </form>
  `;

  wrap.querySelector('#pf-dlg-url').value = link.url || '';
  wrap.querySelector('#pf-dlg-title').value = link.title || '';
  wrap.querySelector('#pf-dlg-subject').value = link.subject || '';
  wrap.querySelector('#pf-dlg-desc').value = link.description || '';
  wrap.querySelector('#pf-dlg-public').checked = Boolean(link.isPublic);

  const { hide } = showModal(wrap);
  setTimeout(() => wrap.querySelector('#pf-dlg-url').focus(), 30);
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);

  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    let url = wrap.querySelector('#pf-dlg-url').value.trim();
    const title = wrap.querySelector('#pf-dlg-title').value.trim();
    const subject = wrap.querySelector('#pf-dlg-subject').value.trim() || 'Général';
    const description = wrap.querySelector('#pf-dlg-desc').value.trim();
    const isPublic = wrap.querySelector('#pf-dlg-public').checked;

    if (!url) { showToast('Veuillez saisir une URL.', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); }
    catch { showToast('Adresse URL invalide.', 'error'); return; }
    if (!title) { showToast('Veuillez saisir un titre.', 'error'); return; }

    try {
      await FirestoreService.updateLink(link.id, { title, url, description, subject, isPublic });
      logAccess(link.id, 'link', 'edit');
      EventBus.emit('link:saved', { linkId: link.id });
      showToast('Lien mis à jour.', 'success');
      hide();
      notify();
    } catch (err) {
      console.error('[PublicFiles] link save failed:', err);
      showToast(`Enregistrement échoué : ${err.message}`, 'error');
    }
  });
}

/** Flatten folders into `{ id, name, depth }`, roots first, for a select. */
function flattenTree(folders, parentId = null, depth = 0, out = []) {
  folders
    .filter(f => parentOf(f) === parentId)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'))
    .forEach(f => {
      out.push({ id: f.id, name: f.name || 'Sans nom', depth });
      flattenTree(folders, f.id, depth + 1, out);
    });
  return out;
}

function openMoveDialog(kind, item) {
  const excluded = kind === 'folder' ? new Set([item.id, ...descendantIds(item.id)]) : new Set();
  // Offer *every* folder as a destination, including ones without public content.
  const targets = flattenTree(state.allFolders.filter(f => !excluded.has(f.id)));
  const currentParent = item.parentId || null;

  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Déplacer « ${escapeHtml(displayName(kind, item))} »</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="pf-dlg-target">Dossier de destination</label>
        <select class="input select" id="pf-dlg-target">
          <option value="">Racine — Fichiers publics</option>
          ${targets.map(t => `<option value="${escapeAttr(t.id)}" ${t.id === currentParent ? 'selected' : ''}>${escapeHtml('— '.repeat(t.depth) + t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Déplacer</button>
      </div>
    </form>
  `;

  const { hide } = showModal(wrap);
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);
  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const destinationId = wrap.querySelector('#pf-dlg-target').value || null;
    if (destinationId === currentParent) { hide(); return; }
    try {
      await moveEntry(kind, item.id, destinationId);
      logAccess(item.id, kind, 'edit');
      showToast('Élément déplacé.', 'success');
      hide();
      notify();
    } catch (err) {
      console.error('[PublicFiles] move failed:', err);
      showToast(`Déplacement échoué : ${err.message}`, 'error');
    }
  });
}

function displayName(kind, item) {
  if (kind === 'folder') return item.name || 'ce dossier';
  if (kind === 'link') return item.title || domainOf(item.url);
  return item.title || 'cette fiche';
}

function kindLabel(kind) {
  return { folder: 'Dossier de fichiers', note: 'Fiche Markdown', link: 'Lien web' }[kind] || 'Élément';
}

function locationOf(item) {
  const parts = folderPath(item?.parentId || null).map(f => f.name || 'Sans nom');
  return ['Fichiers publics', ...parts].join(' / ');
}

/** Recursive totals for a folder and everything nested inside it. */
function folderStats(folderId) {
  const ids = new Set([folderId, ...descendantIds(folderId, state.allFolders)]);
  return {
    folders: ids.size - 1,
    notes: state.allNotes.filter(n => ids.has(n.parentId)).length,
    links: state.allLinks.filter(l => ids.has(l.parentId)).length
  };
}

function propRow(label, value) {
  return `<div class="props__row">
    <dt class="props__key">${escapeHtml(label)}</dt>
    <dd class="props__val">${value || '—'}</dd>
  </div>`;
}

function ownerName(uid) {
  if (!uid) return '—';
  if (AppState.user && uid === AppState.user.uid) {
    return AppState.user.displayName || AppState.user.email || 'Vous';
  }
  return state.userMap[uid] || 'Autre utilisateur';
}

/** Windows-style "Properties" dialog — admin flavour (always shows the owner). */
function openPropertiesDialog(kind, item) {
  if (!item) return;

  const name = kind === 'folder'
    ? (item.name || 'Sans nom')
    : kind === 'link'
      ? (item.title || domainOf(item.url) || 'Sans titre')
      : (item.title || 'Sans titre');

  const rows = [
    propRow('Type', escapeHtml(kindLabel(kind))),
    propRow('Emplacement', escapeHtml(locationOf(item)))
  ];

  if (kind === 'folder') {
    const { folders, notes, links } = folderStats(item.id);
    const bits = [
      `${folders} dossier${folders === 1 ? '' : 's'}`,
      `${notes} fiche${notes === 1 ? '' : 's'}`,
      `${links} lien${links === 1 ? '' : 's'}`
    ];
    rows.push(propRow('Contient', escapeHtml(bits.join(', '))));
    rows.push(propRow('Créé le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifié le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  } else if (kind === 'note') {
    const content = item.content || '';
    const count = item.charCount ?? content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    rows.push(propRow('Taille', escapeHtml(`${count.toLocaleString('fr-FR')} caractères · ${words.toLocaleString('fr-FR')} mot${words === 1 ? '' : 's'}`)));
    rows.push(propRow('Matière', escapeHtml(item.subject || 'Général')));
    if (item.topic) rows.push(propRow('Sujet', escapeHtml(item.topic)));
    rows.push(propRow('Visibilité', escapeHtml(item.isPublic ? 'Publique' : 'Privée')));
    rows.push(propRow('Créée le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifiée le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  } else {
    rows.push(propRow('Adresse',
      `<a class="props__link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>`));
    rows.push(propRow('Domaine', escapeHtml(domainOf(item.url))));
    rows.push(propRow('Matière', escapeHtml(item.subject || 'Général')));
    if (item.description) rows.push(propRow('Description', escapeHtml(item.description)));
    rows.push(propRow('Visibilité', escapeHtml(item.isPublic ? 'Publique' : 'Privée')));
    rows.push(propRow('Créé le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifié le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  }

  rows.push(propRow('Propriétaire', escapeHtml(ownerName(item.uid))));

  const iconHtml = kind === 'link'
    ? iconImg('link', { size: 40, alt: '' })
    : iconImg(kind === 'folder' ? ICON_FOLDER : 'document', { size: 40, alt: '' });

  const wrap = document.createElement('div');
  wrap.className = 'dialog props';
  wrap.innerHTML = `
    <div class="props__head">
      <div class="props__icon">${iconHtml}</div>
      <div class="props__heading">
        <div class="props__name" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        <div class="props__subtitle">${escapeHtml(kindLabel(kind))}</div>
      </div>
    </div>
    <dl class="props__rows">${rows.join('')}</dl>
    <div class="form-actions">
      ${kind === 'link' && item.url ? `<button type="button" class="btn btn--secondary" data-action="copy">${iconImg('copy', { size: 16, alt: '' })}<span>Copier l’URL</span></button>` : ''}
      ${kind !== 'folder' ? `<button type="button" class="btn btn--secondary" data-action="open">${iconImg('edit', { size: 16, alt: '' })}<span>Ouvrir</span></button>` : ''}
      <button type="button" class="btn btn--primary" data-action="close">Fermer</button>
    </div>
  `;

  const { hide } = showModal(wrap);
  wrap.querySelector('[data-action="close"]')?.addEventListener('click', hide);
  wrap.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyText(item.url, 'URL copiée.'));
  wrap.querySelector('[data-action="open"]')?.addEventListener('click', () => {
    hide();
    if (kind === 'note') activate('note', item.id);
    else if (kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
  });
}

/** Tear down. */
export function destroy() {
  closeContextMenu();
  state.container = null;
  state.currentFolderId = null;
  state.folders = [];
  state.allFolders = [];
  state.notes = [];
  state.links = [];
  state.allNotes = [];
  state.allLinks = [];
  state.subjects = [];
  state.userMap = {};
  state.onChanged = null;
  state.selection = null;
}
