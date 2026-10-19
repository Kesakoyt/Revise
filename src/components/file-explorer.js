/**
 * Fiches & Cloud — File Explorer.
 *
 * A hierarchical file manager for the signed-in user: folders that contain
 * sub-folders, Markdown **fiches** and **links**. Supports navigation (a
 * Windows-style navigation pane on the left, a breadcrumb and a list/grid
 * content area), creation / rename / move / delete / **share**, drag-and-drop
 * PDF/DOCX import, public and shared views, search / filter / sort and a live
 * storage-quota indicator.
 *
 * Links are managed here — the former standalone link app has been folded in.
 *
 * The left pane lists the places the current user has access to:
 *   • Mes fichiers      — the user's own tree
 *   • Fichiers partagés — folders other users shared with them (read-only)
 *   • Fiches publiques  — every user's public fiches
 */

import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast, showModal, iconImg } from '../app.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';

/** Icons (Icons8 Fluency slugs verified to exist). */
const ICON_FOLDER = 'opened-folder';
const ICON_GRID = 'thumbnails';

const state = {
  container: null,
  tab: 'mine',            // 'mine' | 'shared' | 'public'
  view: 'list',           // 'list' | 'grid'
  subject: 'all',
  sort: 'date-desc',
  query: '',
  currentFolderId: null,  // null = root of the current place
  folders: [],            // owned folders
  notes: [],              // owned fiches
  links: [],              // owned links
  publicLinks: [],        // other users' public links (root of "Mes fichiers")
  publicNotes: [],        // every user's public fiches
  publicFolders: [],      // folder branches leading to public content
  sharedFolders: [],      // folders owned by others but shared with me
  sharedNotes: [],
  sharedLinks: [],
  directory: [],          // shareable accounts (for the share dialog + names)
  expanded: new Set(),    // nav-tree nodes left open
  subjects: [],
  selection: null,        // { kind, id }
  handlers: [],
  reloadTimer: null
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  container.classList.add('file-explorer-container');

  container.innerHTML = `
    <div class="file-explorer">
      <div class="file-explorer__bar">
        <button class="btn btn--primary" id="fe-new" type="button" aria-haspopup="menu">
          ${iconImg('add', { size: 18, alt: '' })}<span>Nouveau</span><span class="btn__caret" aria-hidden="true"></span>
        </button>

        <div class="search-field">
          ${iconImg('search', { size: 18, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="fe-search"
                 placeholder="Rechercher dans ce dossier…" value="${escapeAttr(state.query)}">
          <button type="button" class="btn-clear" id="fe-clear" ${state.query ? '' : 'hidden'}>&times;</button>
        </div>

        <div class="file-explorer__filters">
          <select class="input select" id="fe-subject" aria-label="Filtrer par matière">
            <option value="all">Toutes les matières</option>
          </select>
          <select class="input select" id="fe-sort" aria-label="Trier">
            <option value="date-desc" ${state.sort === 'date-desc' ? 'selected' : ''}>Plus récents</option>
            <option value="date-asc" ${state.sort === 'date-asc' ? 'selected' : ''}>Plus anciens</option>
            <option value="title-asc" ${state.sort === 'title-asc' ? 'selected' : ''}>Nom (A→Z)</option>
            <option value="title-desc" ${state.sort === 'title-desc' ? 'selected' : ''}>Nom (Z→A)</option>
            <option value="subject-asc" ${state.sort === 'subject-asc' ? 'selected' : ''}>Matière (A→Z)</option>
          </select>
          <div class="view-toggle">
            <button class="view-toggle__btn ${state.view === 'list' ? 'view-toggle__btn--active' : ''}" id="fe-view-list" title="Liste" aria-label="Vue liste">
              ${iconImg('list', { size: 18, alt: '' })}
            </button>
            <button class="view-toggle__btn ${state.view === 'grid' ? 'view-toggle__btn--active' : ''}" id="fe-view-grid" title="Grille" aria-label="Vue grille">
              ${iconImg(ICON_GRID, { size: 18, alt: '' })}
            </button>
          </div>
        </div>
      </div>

      <div class="file-explorer__main">
        <nav class="explorer-nav" id="fe-nav" aria-label="Emplacements"></nav>

        <div class="file-explorer__content">
          <nav class="file-explorer__breadcrumb" id="fe-breadcrumb" aria-label="Chemin"></nav>

          <div class="file-explorer__body" id="fe-body">
            <div class="loading-block"><span class="spinner"></span><p>Chargement…</p></div>
          </div>
        </div>
      </div>

      <div class="drop-zone" id="fe-drop">
        <input type="file" id="fe-file" accept=".pdf,.docx" hidden>
        <div class="drop-zone__content">
          ${iconImg('import', { size: 32, alt: '', className: 'drop-zone__icon' })}
          <div class="drop-zone__text">
            <strong>Déposez un fichier PDF ou DOCX</strong> pour le convertir en Markdown
            <span class="drop-zone__hint">ou <button type="button" class="btn-link" id="fe-browse">parcourir</button></span>
          </div>
        </div>
        <div class="drop-zone__overlay"><span>Déposez le fichier pour importer</span></div>
      </div>

      <div class="file-explorer__quota">
        <div class="quota-bar">
          <div class="quota-bar__head">
            <span class="quota-bar__label">Quota de stockage</span>
            <span class="quota-bar__text" id="fe-quota-text">Chargement…</span>
          </div>
          <div class="quota-bar__track"><div class="quota-bar__fill" id="fe-quota-fill" style="width:0%"></div></div>
        </div>
      </div>
    </div>
  `;

  bindToolbar();
  bindDropZone();
  bindBody();
  bindBus();
  updateChrome();
  renderNav();
  renderBreadcrumb();
  await Promise.all([loadData(), refreshQuota()]);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function bindToolbar() {
  const c = state.container;

  c.querySelector('#fe-new')?.addEventListener('click', e => openNewMenu(e.currentTarget));

  const search = c.querySelector('#fe-search');
  const clear = c.querySelector('#fe-clear');
  let timer = null;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    state.query = search.value.trim().toLowerCase();
    clear.hidden = !state.query;
    timer = setTimeout(renderList, 220);
  });
  clear?.addEventListener('click', () => {
    state.query = '';
    search.value = '';
    clear.hidden = true;
    renderList();
  });

  c.querySelector('#fe-subject')?.addEventListener('change', e => { state.subject = e.target.value; renderList(); });
  c.querySelector('#fe-sort')?.addEventListener('change', e => { state.sort = e.target.value; renderList(); });

  c.querySelector('#fe-view-list')?.addEventListener('click', () => setView('list'));
  c.querySelector('#fe-view-grid')?.addEventListener('click', () => setView('grid'));
}

function setView(view) {
  state.view = view;
  const c = state.container;
  c.querySelector('#fe-view-list')?.classList.toggle('view-toggle__btn--active', view === 'list');
  c.querySelector('#fe-view-grid')?.classList.toggle('view-toggle__btn--active', view === 'grid');
  renderList();
}

/** Show/hide chrome that only applies to the personal "Mes fichiers" place. */
function updateChrome() {
  const c = state.container;
  const mine = state.tab === 'mine';
  c.querySelector('#fe-new')?.toggleAttribute('hidden', !mine);
  c.querySelector('#fe-drop')?.toggleAttribute('hidden', !mine);
}

// ---------------------------------------------------------------------------
// Drag & drop import
// ---------------------------------------------------------------------------

function bindDropZone() {
  const c = state.container;
  const zone = c.querySelector('#fe-drop');
  const input = c.querySelector('#fe-file');

  c.querySelector('#fe-browse')?.addEventListener('click', e => { e.stopPropagation(); input.click(); });
  zone?.addEventListener('click', () => input.click());

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await importFile(file);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach(ev => zone?.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('drop-zone--active');
  }));
  ['dragleave', 'dragend', 'drop'].forEach(ev => zone?.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('drop-zone--active');
  }));
  zone?.addEventListener('drop', async e => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await importFile(file);
  });
}

async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx'].includes(ext)) {
    showToast('Seuls les formats .pdf et .docx sont pris en charge.', 'error');
    return;
  }

  showToast(`Conversion de ${file.name}…`, 'info');
  try {
    const result = await ConverterService.convertFile(file);
    if (!result?.markdown?.trim()) throw new Error('Le document ne contient aucun texte exploitable.');

    showToast('Fichier converti.', 'success');
    EventBus.emit('app:open', {
      appId: 'markdown-editor',
      params: {
        importedContent: result.markdown,
        importedTitle: result.title || 'Document importé',
        parentId: state.currentFolderId
      }
    });
  } catch (err) {
    console.error('[Explorer] conversion failed:', err);
    showToast(`Conversion échouée : ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadData() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;

  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement…</p></div>`;

  const uid = AppState.user?.uid;
  const failures = [];

  // Every collection loads independently: a denial or a missing `folders` /
  // `directory` rule must not blank out the whole explorer.
  const safe = (label, fn) => Promise.resolve()
    .then(fn)
    .catch(err => {
      console.warn(`[Explorer] ${label} load failed:`, err.message);
      failures.push(label);
      return [];
    });

  try {
    const [
      folders, notes, links,
      publicNotes, publicLinks, publicFolders,
      sharedFolders, sharedNotes, sharedLinks,
      directory
    ] = await Promise.all([
      uid ? safe('dossiers', () => FirestoreService.getUserFolders(uid)) : [],
      uid ? safe('fiches', () => FirestoreService.getUserNotes(uid)) : [],
      uid ? safe('liens', () => FirestoreService.getUserLinks(uid)) : [],
      safe('fiches publiques', () => FirestoreService.getPublicNotes({})),
      safe('liens publics', () => FirestoreService.getPublicLinks({})),
      safe('dossiers publics', () => FirestoreService.getPublicFolders()),
      uid ? safe('dossiers partagés', () => FirestoreService.getSharedFolders(uid)) : [],
      uid ? safe('fiches partagées', () => FirestoreService.getSharedNotes(uid)) : [],
      uid ? safe('liens partagés', () => FirestoreService.getSharedLinks(uid)) : [],
      safe('annuaire', () => FirestoreService.getDirectory())
    ]);

    state.folders = folders;
    state.notes = notes;
    state.links = links;
    state.publicFolders = publicFolders;

    // Public content is browsable as a tree. A fiche/link whose folder isn't in
    // the public branch list (legacy doc, or a flag that hasn't been re-synced
    // yet) is parked at the root rather than hidden.
    const publicIds = new Set(publicFolders.map(f => f.id));
    const park = item => ({
      ...item,
      parentId: item.parentId && publicIds.has(item.parentId) ? item.parentId : null
    });
    state.publicNotes = publicNotes.map(park);
    state.publicLinks = publicLinks.map(park);

    state.sharedFolders = sharedFolders;
    state.sharedNotes = sharedNotes;
    state.sharedLinks = sharedLinks;
    state.directory = directory;

    if (state.currentFolderId && !activeFolders().some(f => f.id === state.currentFolderId)) {
      state.currentFolderId = null;
    }

    const subjects = new Set();
    [...notes, ...links, ...publicNotes, ...publicLinks, ...sharedNotes, ...sharedLinks]
      .forEach(item => { if (item.subject?.trim()) subjects.add(item.subject.trim()); });
    state.subjects = [...subjects].sort();

    populateSubjectFilter();
    renderNav();
    renderBreadcrumb();
    renderList();

    if (failures.length) {
      showToast(
        `Certaines données sont indisponibles (${[...new Set(failures)].join(', ')}). ` +
        'Vérifiez les règles de sécurité Firestore.',
        'error'
      );
    }
  } catch (err) {
    console.error('[Explorer] load failed:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Chargement impossible</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="fe-retry">Réessayer</button>
      </div>`;
    body.querySelector('#fe-retry')?.addEventListener('click', loadData);
  }
}

/** Debounced reload, so bursts of events cause a single refresh. */
function scheduleReload() {
  clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(() => { loadData(); refreshQuota(); }, 60);
}

function populateSubjectFilter() {
  const select = state.container?.querySelector('#fe-subject');
  if (!select) return;
  select.innerHTML = '<option value="all">Toutes les matières</option>' +
    state.subjects.map(s => `<option value="${escapeAttr(s)}" ${state.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
}

// ---------------------------------------------------------------------------
// Places (the three roots listed in the navigation pane)
// ---------------------------------------------------------------------------

const PLACE = {
  mine:   { label: 'Mes fichiers',      icon: ICON_FOLDER },
  shared: { label: 'Fichiers partagés', icon: 'shared-folder' },
  public: { label: 'Fiches publiques',  icon: 'bookmark' }
};

/** Folders backing the current place. */
function activeFolders() {
  if (state.tab === 'shared') return state.sharedFolders;
  if (state.tab === 'public') return state.publicFolders;
  return state.folders;
}

/** Fiches visible in the content area. */
function activeNotes() {
  if (state.tab === 'shared') return state.sharedNotes;
  if (state.tab === 'public') return state.publicNotes;
  return state.notes;
}

/** Links visible in the content area. */
function activeLinks() {
  if (state.tab === 'shared') return state.sharedLinks;
  if (state.tab === 'public') return state.publicLinks;
  return state.links;
}

/** Display name for a uid, using the `directory` when it is loaded. */
function userLabel(uid) {
  if (!uid) return '—';
  const entry = state.directory.find(d => (d.id || d.uid) === uid);
  if (!entry) return uid;
  return entry.displayName || entry.email || uid;
}

// ---------------------------------------------------------------------------
// Navigation pane (Windows-style places tree)
// ---------------------------------------------------------------------------

function renderNav() {
  const nav = state.container?.querySelector('#fe-nav');
  if (!nav) return;

  const ownRoots = state.folders.filter(f => !f.parentId);
  const sharedIds = new Set(state.sharedFolders.map(f => f.id));
  // A shared folder whose parent is not shared with me is the root of a grant.
  const sharedRoots = state.sharedFolders.filter(f => !f.parentId || !sharedIds.has(f.parentId));
  const publicIds = new Set(state.publicFolders.map(f => f.id));
  const publicRoots = state.publicFolders.filter(f => !f.parentId || !publicIds.has(f.parentId));

  const mineCount = state.folders.length + state.notes.length + state.links.length;
  const publicCount = state.publicFolders.length + state.publicNotes.length + state.publicLinks.length;

  nav.innerHTML = `
    ${navItem('mine', PLACE.mine.icon, PLACE.mine.label, mineCount)}
    <div class="explorer-nav__tree">${ownRoots.map(f => treeNode(f, 'mine', 0, state.folders)).join('')}</div>
    ${navItem('shared', PLACE.shared.icon, PLACE.shared.label, state.sharedFolders.length)}
    <div class="explorer-nav__tree">${sharedRoots.map(f => treeNode(f, 'shared', 0, state.sharedFolders)).join('')}</div>
    ${navItem('public', PLACE.public.icon, PLACE.public.label, publicCount)}
    <div class="explorer-nav__tree">${publicRoots.map(f => treeNode(f, 'public', 0, state.publicFolders)).join('')}</div>
  `;

  nav.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.nav, null));
  });
  nav.querySelectorAll('[data-nav-folder]').forEach(row => {
    row.addEventListener('click', () => goTo(row.dataset.navTab, row.dataset.navFolder));
  });
  nav.querySelectorAll('[data-nav-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.navToggle;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderNav();
    });
  });
}

function navItem(tab, icon, label, count) {
  const active = state.tab === tab;
  return `
    <button type="button" class="explorer-nav__item ${active ? 'explorer-nav__item--active' : ''}" data-nav="${tab}">
      ${iconImg(icon, { size: 18, alt: '', className: 'explorer-nav__icon' })}
      <span class="explorer-nav__label">${escapeHtml(label)}</span>
      ${count ? `<span class="explorer-nav__count">${count}</span>` : ''}
    </button>`;
}

/** One recursive node of the places tree. */
function treeNode(folder, tab, depth, pool) {
  if (depth > 24) return '';
  const children = pool.filter(f => f.parentId === folder.id);
  const open = state.expanded.has(folder.id);
  const active = state.tab === tab && state.currentFolderId === folder.id;
  const shared = tab !== 'public' && Array.isArray(folder.sharedWith) && folder.sharedWith.length > 0;
  const icon = tab === 'shared' ? 'shared-folder' : tab === 'public' ? 'opened-folder' : 'user-folder';

  return `
    <div class="explorer-tree__node">
      <div class="explorer-tree__row ${active ? 'explorer-tree__row--active' : ''}"
           style="padding-left:${8 + depth * 14}px"
           data-nav-folder="${escapeAttr(folder.id)}" data-nav-tab="${tab}" role="button" tabindex="0">
        ${children.length
          ? `<button type="button" class="explorer-tree__caret ${open ? 'explorer-tree__caret--open' : ''}"
                     data-nav-toggle="${escapeAttr(folder.id)}" tabindex="-1"
                     aria-label="${open ? 'Réduire' : 'Développer'}">${open ? '▾' : '▸'}</button>`
          : '<span class="explorer-tree__caret explorer-tree__caret--leaf"></span>'}
        ${iconImg(icon, { size: 15, alt: '', className: 'explorer-tree__icon' })}
        <span class="explorer-tree__label">${escapeHtml(folder.name || 'Sans nom')}</span>
        ${shared ? `<span class="explorer-tree__badge" title="Partagé avec ${folder.sharedWith.length} personne(s)">${iconImg('collaboration', { size: 13, alt: '' })}</span>` : ''}
      </div>
      ${open && children.length
        ? `<div class="explorer-tree__children">${children.map(c => treeNode(c, tab, depth + 1, pool)).join('')}</div>`
        : ''}
    </div>`;
}

/** Expand every ancestor of `folderId` so it is visible in the tree. */
function expandAncestors(tab, folderId) {
  const pool = tab === 'shared' ? state.sharedFolders
    : tab === 'public' ? state.publicFolders
    : state.folders;
  const byId = new Map(pool.map(f => [f.id, f]));
  const guard = new Set();
  let cur = byId.get(folderId)?.parentId || null;
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    state.expanded.add(cur);
    cur = byId.get(cur).parentId || null;
  }
}

/** Switch place and/or folder, then refresh the explorer chrome. */
function goTo(tab, folderId = null) {
  state.tab = tab;
  state.currentFolderId = folderId || null;
  state.selection = null;
  if (folderId) expandAncestors(tab, folderId);
  updateChrome();
  renderNav();
  renderBreadcrumb();
  renderList();
  state.container?.querySelector('#fe-body')?.scrollTo?.({ top: 0 });
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function parentOf(item) { return item.parentId || null; }

/**
 * Ancestor folders from root down to `folderId`.
 * @param {string|null} folderId
 * @param {Array<Object>} [pool] folder pool to walk (defaults to the current place)
 */
function folderPath(folderId, pool = activeFolders()) {
  const byId = new Map(pool.map(f => [f.id, f]));
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
  const nav = state.container?.querySelector('#fe-breadcrumb');
  if (!nav) return;

  nav.hidden = false;
  const place = PLACE[state.tab];
  const path = folderPath(state.currentFolderId);
  const parts = [
    `<button type="button" class="breadcrumb__crumb" data-folder="">
      ${iconImg(place.icon, { size: 15, alt: '' })}<span>${escapeHtml(place.label)}</span>
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

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Direct children of a folder in the current place.
 * @param {string|null} folderId
 */
function childrenOf(folderId) {
  return {
    folders: activeFolders().filter(f => parentOf(f) === folderId),
    notes: activeNotes().filter(n => parentOf(n) === folderId),
    links: activeLinks().filter(l => parentOf(l) === folderId)
  };
}

function matchesQuery(obj, keys) {
  if (!state.query) return true;
  return keys.some(k => (obj[k] || '').toLowerCase().includes(state.query));
}

function matchesSubject(obj) {
  if (state.subject === 'all') return true;
  return (obj.subject || '').trim() === state.subject;
}

function sortFiles(entries) {
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
    const cmp = typeof x === 'string' ? x.localeCompare(y) : (x - y);
    if (cmp !== 0) return sign * cmp;
    return (a.data.title || '').localeCompare(b.data.title || '');
  });
}

function renderList() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;

  // Every place is a real folder tree, so the listing is always the direct
  // children of the current folder.
  const { folders, notes, links } = childrenOf(state.currentFolderId);

  const shownFolders = folders
    .filter(f => matchesQuery(f, ['name']))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const linkMatches = l => matchesSubject(l) && matchesQuery(l, ['title', 'url', 'description', 'subject']);

  const files = [
    ...notes.filter(n => matchesSubject(n) && matchesQuery(n, ['title', 'subject', 'topic', 'content']))
      .map(data => ({ kind: 'note', id: data.id, data })),
    ...links.filter(linkMatches).map(data => ({ kind: 'link', id: data.id, data }))
  ];

  // Public links from everyone surface at the root of "Mes fichiers" too (their
  // owners' folder trees aren't browsable from there); the user's own public
  // links already appear inside their folders, so they are left out here.
  if (state.tab === 'mine' && state.currentFolderId === null) {
    const self = AppState.user?.uid;
    files.push(
      ...state.publicLinks
        .filter(l => l.uid !== self)
        .filter(linkMatches)
        .map(data => ({ kind: 'link', id: data.id, data }))
    );
  }

  const sorted = sortFiles(files);

  state.selection = null;

  if (shownFolders.length === 0 && sorted.length === 0) {
    body.innerHTML = emptyStateHtml();
    body.querySelector('#fe-empty-new-folder')?.addEventListener('click', () => openFolderDialog({ parentId: state.currentFolderId }));
    body.querySelector('#fe-empty-new-note')?.addEventListener('click', () => openNewNote());
    return;
  }

  if (state.view === 'grid') {
    body.innerHTML = `<div class="file-grid">
      ${shownFolders.map(folderCard).join('')}
      ${sorted.map(entryCard).join('')}
    </div>`;
  } else {
    body.innerHTML = `<div class="file-list">
      ${shownFolders.map(folderRow).join('')}
      ${sorted.map(entryRow).join('')}
    </div>`;
  }
}

function emptyStateHtml() {
  const searching = Boolean(state.query) || state.subject !== 'all';
  const inFolder = Boolean(state.currentFolderId);

  if (searching) {
    return `
      <div class="empty-state">
        ${iconImg('search', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Aucun résultat</h3>
        <p class="empty-state__description">Aucun élément de ce dossier ne correspond à la recherche ou au filtre.</p>
      </div>`;
  }

  if (state.tab === 'public') {
    const inPublicFolder = Boolean(state.currentFolderId);
    return `
      <div class="empty-state">
        ${iconImg('bookmark', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">${inPublicFolder ? 'Dossier vide' : 'Aucun contenu public'}</h3>
        <p class="empty-state__description">${inPublicFolder
          ? 'Ce dossier public ne contient aucun élément pour le moment.'
          : 'Personne n\'a encore rendu de fiche ou de lien public.'}</p>
      </div>`;
  }

  if (state.tab === 'shared') {
    return `
      <div class="empty-state">
        ${iconImg('shared-folder', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Aucun élément partagé</h3>
        <p class="empty-state__description">Personne n'a encore partagé de dossier avec vous.</p>
      </div>`;
  }

  const title = inFolder ? 'Dossier vide' : 'Aucun contenu pour le moment';
  const desc = inFolder
    ? 'Créez un sous-dossier, une fiche ou un lien dans ce dossier.'
    : 'Créez votre premier dossier, une fiche Markdown ou un lien, ou déposez un PDF/DOCX.';

  return `
    <div class="empty-state">
      ${iconImg(ICON_FOLDER, { size: 48, alt: '', className: 'empty-state__icon' })}
      <h3 class="empty-state__title">${title}</h3>
      <p class="empty-state__description">${desc}</p>
      <div class="empty-state__actions">
        <button class="btn btn--secondary" id="fe-empty-new-folder">${iconImg('add-folder', { size: 18, alt: '' })}<span>Nouveau dossier</span></button>
        <button class="btn btn--primary" id="fe-empty-new-note">${iconImg('document', { size: 18, alt: '' })}<span>Nouvelle fiche</span></button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Row / card renderers
// ---------------------------------------------------------------------------

function itemAttrs(kind, id) {
  return `data-kind="${kind}" data-id="${escapeAttr(id)}" tabindex="0" role="button"`;
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
  const domain = domainOf(link.url);
  return `
    <div class="file-item" ${itemAttrs('link', link.id)}>
      ${iconImg('link', { size: 20, alt: '', className: 'file-item__icon' })}
      <span class="file-item__title">${escapeHtml(link.title || domain || 'Sans titre')}</span>
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
  const domain = domainOf(link.url);
  return `
    <article class="file-card" ${itemAttrs('link', link.id)}>
      <div class="file-card__icon">${iconImg('link', { size: 48, alt: '' })}</div>
      <div class="file-card__title">${escapeHtml(link.title || domain || 'Sans titre')}</div>
      <div class="file-card__actions">${propsBtn('link', link.id)}</div>
    </article>`;
}

function entryRow(entry) { return entry.kind === 'note' ? noteRow(entry.data) : linkRow(entry.data); }
function entryCard(entry) { return entry.kind === 'note' ? noteCard(entry.data) : linkCard(entry.data); }

function propsBtn(kind, id) {
  return `<button type="button" class="btn btn--icon btn-props" title="Propriétés" aria-label="Propriétés" data-props-kind="${escapeAttr(kind)}" data-props-id="${escapeAttr(id)}">
    ${iconImg('info', { size: 16, alt: '' })}
  </button>`;
}

// ---------------------------------------------------------------------------
// Body events (delegated: survives list re-renders)
// ---------------------------------------------------------------------------

function bindBody() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;

  body.addEventListener('click', e => {
    const propsBtnEl = e.target.closest('.btn-props');
    if (propsBtnEl) {
      e.stopPropagation();
      const kind = propsBtnEl.dataset.propsKind;
      const id = propsBtnEl.dataset.propsId;
      if (kind && id) {
        const data = kind === 'folder' ? activeFolders().find(f => f.id === id)
          : kind === 'note' ? activeNotes().find(n => n.id === id)
          : findLink(id);
        openPropertiesDialog(kind, data);
      }
      return;
    }
    const item = e.target.closest('[data-kind][data-id]');
    if (!item) { setSelection(null); return; }
    activate(item.dataset.kind, item.dataset.id);
  });

  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return; // row action buttons handle their own activation
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

function setSelection(sel) {
  state.selection = sel;
  state.container?.querySelectorAll('[data-kind][data-id]').forEach(el => {
    const on = sel && el.dataset.kind === sel.kind && el.dataset.id === sel.id;
    if (el.classList.contains('file-item')) el.classList.toggle('file-item--selected', on);
    if (el.classList.contains('file-card')) el.classList.toggle('file-card--selected', on);
  });
}

/**
 * Look a link up by id: in the current place first, then everywhere else the
 * user can see (own, shared, public).
 */
function findLink(id) {
  return activeLinks().find(l => l.id === id)
    || state.links.find(l => l.id === id)
    || state.sharedLinks.find(l => l.id === id)
    || state.publicLinks.find(l => l.id === id)
    || null;
}

function activate(kind, id) {
  if (kind === 'folder') { enterFolder(id); return; }
  if (kind === 'note') { EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId: id } }); return; }
  if (kind === 'link') {
    const link = findLink(id);
    if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer');
  }
}

function enterFolder(folderId) {
  goTo(state.tab, folderId);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function openNewMenu(anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  showContextMenu(rect.left, rect.bottom + 4, newMenuItems());
}

function newMenuItems() {
  return [
    { label: 'Nouveau dossier', icon: 'add-folder', onSelect: () => openFolderDialog({ parentId: state.currentFolderId }) },
    { label: 'Nouvelle fiche', icon: 'document', shortcut: 'Ctrl+N', onSelect: () => openNewNote() },
    { label: 'Nouveau lien', icon: 'link', onSelect: () => openLinkDialog() },
    { separator: true },
    { label: 'Importer un fichier (PDF/DOCX)…', icon: 'import', onSelect: () => browseForFile() }
  ];
}

function backgroundMenuItems() {
  const sortSubmenu = [
    { label: 'Plus récents', checked: state.sort === 'date-desc', onSelect: () => setSort('date-desc') },
    { label: 'Plus anciens', checked: state.sort === 'date-asc', onSelect: () => setSort('date-asc') },
    { label: 'Nom (A→Z)', checked: state.sort === 'title-asc', onSelect: () => setSort('title-asc') },
    { label: 'Nom (Z→A)', checked: state.sort === 'title-desc', onSelect: () => setSort('title-desc') },
    { label: 'Matière (A→Z)', checked: state.sort === 'subject-asc', onSelect: () => setSort('subject-asc') }
  ];
  const viewSubmenu = [
    { label: 'Liste', icon: 'list', checked: state.view === 'list', onSelect: () => setView('list') },
    { label: 'Grille', icon: ICON_GRID, checked: state.view === 'grid', onSelect: () => setView('grid') }
  ];
  const refresh = { label: 'Rafraîchir', icon: 'refresh', onSelect: () => { scheduleReload(); showToast('Explorateur rafraîchi.', 'info'); } };
  const display = [
    { label: 'Affichage', icon: ICON_GRID, submenu: viewSubmenu },
    { label: 'Trier par', icon: 'sorting-arrows', submenu: sortSubmenu }
  ];

  // Creation is only possible in the user's own tree.
  if (state.tab !== 'mine') {
    return [refresh, { separator: true }, ...display];
  }

  return [
    { label: 'Nouveau dossier', icon: 'add-folder', onSelect: () => openFolderDialog({ parentId: state.currentFolderId }) },
    { label: 'Nouvelle fiche', icon: 'document', shortcut: 'Ctrl+N', onSelect: () => openNewNote() },
    { label: 'Nouveau lien', icon: 'link', onSelect: () => openLinkDialog() },
    { label: 'Importer un fichier (PDF/DOCX)…', icon: 'import', onSelect: () => browseForFile() },
    { separator: true },
    refresh,
    { separator: true },
    ...display
  ];
}

function itemMenu(sel) {
  if (sel.kind === 'folder') return folderMenuItems(activeFolders().find(f => f.id === sel.id));
  if (sel.kind === 'note') return noteMenuItems(activeNotes().find(n => n.id === sel.id));
  return linkMenuItems(findLink(sel.id));
}

function folderMenuItems(folder) {
  if (!folder) return [];
  const owner = AppState.user && folder.uid === AppState.user.uid;
  const admin = AppState.isAdmin === true;

  const open = { label: 'Ouvrir', icon: ICON_FOLDER, onSelect: () => enterFolder(folder.id) };
  const properties = { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('folder', folder) };
  const copy = { label: 'Copier le nom', icon: 'copy', onSelect: () => copyText(folder.name || 'Sans nom', 'Nom copié.') };
  // Publishing a folder cascades to everything inside it — admins only.
  const publish = {
    label: folder.isPublic ? 'Rendre privé (tout le contenu)' : 'Rendre public (tout le contenu)',
    icon: folder.isPublic ? 'lock' : 'unlock',
    onSelect: () => toggleFolderPublic(folder)
  };

  if (!owner) {
    const items = [open, { separator: true }, copy];
    if (admin) items.push({ separator: true }, publish);
    items.push({ separator: true }, properties);
    return items;
  }

  const items = [
    open,
    { label: 'Renommer', icon: 'edit', onSelect: () => openFolderDialog({ folder }) },
    { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('folder', folder) },
    { separator: true },
    { label: 'Partager…', icon: 'share', onSelect: () => openShareDialog(folder) }
  ];
  if (admin) items.push({ separator: true }, publish);
  items.push(
    { separator: true },
    { label: 'Nouvelle fiche', icon: 'document', onSelect: () => openNewNote(folder.id) },
    { label: 'Nouveau lien', icon: 'link', onSelect: () => openLinkDialog(null, folder.id) },
    { separator: true },
    { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteFolder(folder) },
    { separator: true },
    properties
  );
  return items;
}

function noteMenuItems(note) {
  if (!note) return [];
  const owner = AppState.user && note.uid === AppState.user.uid;
  const admin = AppState.isAdmin === true;
  const items = [{ label: 'Ouvrir', icon: 'document', onSelect: () => openNote(note.id) }];

  if (owner) {
    items.push(
      { label: 'Renommer', icon: 'edit', onSelect: () => renameNote(note) },
      { label: 'Dupliquer', icon: 'copy', onSelect: () => duplicateNote(note) },
      { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('note', note) }
    );
  } else {
    items.push({ label: 'Copier le titre', icon: 'copy', onSelect: () => copyText(note.title || 'Sans titre', 'Titre copié.') });
  }

  // Visibility is an admin decision.
  if (admin) {
    items.push(
      { separator: true },
      { label: note.isPublic ? 'Rendre privée' : 'Rendre publique', icon: note.isPublic ? 'lock' : 'unlock', onSelect: () => togglePublic(note) }
    );
  }

  if (owner) {
    items.push(
      { separator: true },
      { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteEntry('note', note.id) }
    );
  }

  items.push({ separator: true }, { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('note', note) });
  return items;
}

function linkMenuItems(link) {
  if (!link) return [];
  const owner = AppState.user && link.uid === AppState.user.uid;
  const admin = AppState.isAdmin === true;
  const items = [
    { label: 'Ouvrir dans un onglet', icon: 'external-link', onSelect: () => window.open(link.url, '_blank', 'noopener,noreferrer') },
    { label: 'Copier l’URL', icon: 'copy', onSelect: () => copyText(link.url, 'URL copiée.') }
  ];

  if (owner) {
    items.push(
      { label: 'Modifier', icon: 'edit', onSelect: () => openLinkDialog(link) },
      { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('link', link) }
    );
  }

  if (admin) {
    items.push({ separator: true }, { label: link.isPublic ? 'Rendre privé' : 'Rendre public', icon: link.isPublic ? 'lock' : 'unlock', onSelect: () => toggleLinkPublic(link) });
  }

  if (owner) {
    items.push(
      { separator: true },
      { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteEntry('link', link.id) }
    );
  }

  items.push({ separator: true }, { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('link', link) });
  return items;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function openNewNote(parentId = state.currentFolderId) {
  EventBus.emit('app:open', { appId: 'markdown-editor', params: { parentId } });
}
function openNote(noteId) {
  if (!noteId) return;
  EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId } });
}
function browseForFile() {
  state.container?.querySelector('#fe-file')?.click();
}
function setSort(sort) {
  state.sort = sort;
  const select = state.container?.querySelector('#fe-sort');
  if (select) select.value = sort;
  renderList();
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

function deleteEntry(kind, id) {
  if (kind === 'note') deleteNote(id);
  else if (kind === 'link') deleteLink(id);
}

async function deleteNote(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!confirm(`Supprimer définitivement « ${note?.title || 'cette fiche'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    await FirestoreService.deleteNote(noteId);
    if (uid) FirestoreService.logAccess({ uid, documentId: noteId, documentType: 'note', action: 'delete' });
    if (note?.isPublic && uid) await FirestoreService.syncTreeFlags(uid, AppState.user?.displayName || '');
    EventBus.emit('note:deleted', { noteId });
    showToast('Fiche supprimée.', 'success');
  } catch (err) {
    console.error('[Explorer] delete note failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

async function deleteLink(linkId) {
  const link = state.links.find(l => l.id === linkId);
  if (!confirm(`Supprimer « ${link?.title || 'ce lien'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    await FirestoreService.deleteLink(linkId);
    if (uid) FirestoreService.logAccess({ uid, documentId: linkId, documentType: 'link', action: 'delete' });
    if (link?.isPublic && uid) await FirestoreService.syncTreeFlags(uid, AppState.user?.displayName || '');
    EventBus.emit('link:deleted', { linkId });
    showToast('Lien supprimé.', 'success');
  } catch (err) {
    console.error('[Explorer] delete link failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

/**
 * Ids of every folder nested (directly or not) inside `folderId`.
 * @param {string|null} folderId
 * @param {Array<Object>} [pool] folder pool to walk (defaults to the current place)
 */
function descendantIds(folderId, pool = activeFolders()) {
  const ids = new Set();
  const walk = id => {
    pool.forEach(f => {
      if (parentOf(f) === id && !ids.has(f.id)) { ids.add(f.id); walk(f.id); }
    });
  };
  walk(folderId);
  return ids;
}

async function deleteFolder(folder) {
  const ids = new Set([folder.id, ...descendantIds(folder.id, state.folders)]);
  const folders = state.folders.filter(f => ids.has(f.id));
  const notes = state.notes.filter(n => ids.has(n.parentId));
  const links = state.links.filter(l => ids.has(l.parentId));

  const parts = [`${folders.length} dossier${folders.length === 1 ? '' : 's'}`];
  if (notes.length) parts.push(`${notes.length} fiche${notes.length === 1 ? '' : 's'}`);
  if (links.length) parts.push(`${links.length} lien${links.length === 1 ? '' : 's'}`);
  if (!confirm(`Supprimer « ${folder.name} » et tout son contenu (${parts.join(', ')}) ? Action définitive.`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    await Promise.all([
      ...folders.map(f => FirestoreService.deleteFolder(f.id)),
      ...notes.map(n => FirestoreService.deleteNote(n.id)),
      ...links.map(l => FirestoreService.deleteLink(l.id))
    ]);

    if (notes.length && uid) QuotaManager.recalculateQuota(uid).then(q => EventBus.emit('quota:updated', q)).catch(() => {});
    if (uid && (notes.some(n => n.isPublic) || links.some(l => l.isPublic))) {
      await FirestoreService.syncTreeFlags(uid, AppState.user?.displayName || '');
    }
    if (state.currentFolderId && ids.has(state.currentFolderId)) state.currentFolderId = null;

    if (notes.length) EventBus.emit('note:deleted', { folderId: folder.id });
    if (links.length) EventBus.emit('link:deleted', { folderId: folder.id });
    showToast('Dossier supprimé.', 'success');
    scheduleReload();
  } catch (err) {
    console.error('[Explorer] delete folder failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

function renameNote(note) {
  openTextDialog({
    title: 'Renommer la fiche',
    label: 'Nom de la fiche',
    value: note.title || '',
    onSave: async name => {
      const uid = AppState.user?.uid;
      await FirestoreService.updateNote(note.id, { title: name });
      if (uid) FirestoreService.logAccess({ uid, documentId: note.id, documentType: 'note', action: 'edit' });
      EventBus.emit('note:saved', { noteId: note.id });
      showToast('Fiche renommée.', 'success');
    }
  });
}

async function duplicateNote(note) {
  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour dupliquer.', 'error'); return; }
  try {
    showToast('Duplication…', 'info');
    const id = await FirestoreService.createNote({
      uid,
      title: `${note.title || 'Sans titre'} (copie)`,
      content: note.content || '',
      subject: note.subject,
      topic: note.topic,
      isPublic: false,
      parentId: note.parentId || null
    });
    FirestoreService.logAccess({ uid, documentId: id, documentType: 'note', action: 'create' });
    EventBus.emit('note:saved', { noteId: id });
    showToast('Fiche dupliquée.', 'success');
  } catch (err) {
    console.error('[Explorer] duplicate failed:', err);
    showToast(`Duplication échouée : ${err.message}`, 'error');
  }
}

/** Display name of an item's owner, resolved from the loaded directory. */
function ownerNameFor(uid) {
  if (!uid) return '';
  const entry = state.directory.find(d => (d.id || d.uid) === uid);
  return entry?.displayName || entry?.email || '';
}

async function togglePublic(note) {
  try {
    const next = !note.isPublic;
    await FirestoreService.updateNote(note.id, { isPublic: next });
    if (AppState.user?.uid) FirestoreService.logAccess({ uid: AppState.user.uid, documentId: note.id, documentType: 'note', action: 'edit' });
    // Publishing changes the folder branches that lead to public content.
    if (note.uid) await FirestoreService.syncTreeFlags(note.uid, ownerNameFor(note.uid));
    EventBus.emit('note:saved', { noteId: note.id });
    showToast(next ? 'Fiche rendue publique.' : 'Fiche rendue privée.', 'success');
  } catch (err) {
    console.error('[Explorer] toggle public failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

async function toggleLinkPublic(link) {
  try {
    const next = !link.isPublic;
    await FirestoreService.updateLink(link.id, { isPublic: next });
    if (AppState.user?.uid) FirestoreService.logAccess({ uid: AppState.user.uid, documentId: link.id, documentType: 'link', action: 'edit' });
    if (link.uid) await FirestoreService.syncTreeFlags(link.uid, ownerNameFor(link.uid));
    EventBus.emit('link:saved', { linkId: link.id });
    showToast(next ? 'Lien rendu public.' : 'Lien rendu privé.', 'success');
  } catch (err) {
    console.error('[Explorer] toggle link public failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

/** Publish/unpublish a whole folder subtree (admin only). */
async function toggleFolderPublic(folder) {
  if (AppState.isAdmin !== true) return;
  const next = !(folder.isPublic === true);
  try {
    showToast(next ? 'Publication du dossier…' : 'Dépublication du dossier…', 'info');
    await FirestoreService.setFolderPublic(folder.id, next, {
      ownerUid: folder.uid,
      ownerName: ownerNameFor(folder.uid)
    });
    EventBus.emit('note:saved', { folderId: folder.id });
    showToast(
      next ? 'Dossier et tout son contenu rendus publics.' : 'Dossier et tout son contenu rendus privés.',
      'success'
    );
    scheduleReload();
  } catch (err) {
    console.error('[Explorer] toggle folder public failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

async function moveEntry(kind, id, destinationId) {
  if (kind === 'folder') await FirestoreService.updateFolder(id, { parentId: destinationId });
  else if (kind === 'note') await FirestoreService.updateNote(id, { parentId: destinationId });
  else await FirestoreService.updateLink(id, { parentId: destinationId });

  // A move can carry an item into — or out of — a shared subtree, so the
  // inherited grant lists have to be recomputed for the whole owner tree.
  const uid = AppState.user?.uid;
  if (uid) {
    await FirestoreService.syncShares({
      ownerUid: uid,
      ownerName: AppState.user?.displayName || ''
    }).catch(err => console.warn('[Explorer] share re-sync skipped:', err.message));
  }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Generic single-field text dialog (folder create/rename, note rename). */
function openTextDialog({ title, label, value = '', onSave }) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">${escapeHtml(title)}</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="dlg-name">${escapeHtml(label)}</label>
        <input class="input" type="text" id="dlg-name" maxlength="60" required>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Enregistrer</button>
      </div>
    </form>
  `;
  const input = wrap.querySelector('#dlg-name');
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
      console.error('[Explorer] dialog save failed:', err);
      showToast(`Échec : ${err.message}`, 'error');
    }
  });
}

function openFolderDialog({ folder = null, parentId = null }) {
  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour créer un dossier.', 'error'); return; }

  if (folder) {
    openTextDialog({
      title: 'Renommer le dossier',
      label: 'Nom du dossier',
      value: folder.name || '',
      onSave: async name => {
        await FirestoreService.updateFolder(folder.id, { name });
        scheduleReload();
        showToast('Dossier renommé.', 'success');
      }
    });
    return;
  }

  openTextDialog({
    title: 'Nouveau dossier',
    label: 'Nom du dossier',
    value: '',
    onSave: async name => {
      await FirestoreService.createFolder({ uid, name, parentId });
      scheduleReload();
      showToast('Dossier créé.', 'success');
    }
  });
}

function openLinkDialog(link = null, parentId = undefined) {
  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour enregistrer un lien.', 'error'); return; }

  const editing = Boolean(link);
  const targetParent = editing ? (link.parentId || null) : (parentId === undefined ? state.currentFolderId : parentId);

  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">${editing ? 'Modifier le lien' : 'Nouveau lien'}</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="dlg-url">URL <span class="required">*</span></label>
        <input class="input" type="url" id="dlg-url" placeholder="https://exemple.fr/article" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="dlg-title">Titre <span class="required">*</span></label>
        <input class="input" type="text" id="dlg-title" placeholder="Nom de la ressource" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="dlg-subject">Matière</label>
        <input class="input" type="text" id="dlg-subject" list="dlg-subjects" placeholder="ex : Informatique">
        <datalist id="dlg-subjects">${state.subjects.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label" for="dlg-desc">Description (facultatif)</label>
        <textarea class="textarea" id="dlg-desc" rows="2" placeholder="Résumé ou note personnelle…"></textarea>
      </div>
      <label class="toggle" title="Rendre ce lien visible dans « Liens publics »">
        <input type="checkbox" class="toggle__input" id="dlg-public">
        <span class="toggle__slider"></span>
        <span class="toggle__label">Public</span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">${iconImg('save', { size: 16, alt: '' })}<span>${editing ? 'Mettre à jour' : 'Enregistrer'}</span></button>
      </div>
    </form>
  `;

  wrap.querySelector('#dlg-url').value = link?.url || '';
  wrap.querySelector('#dlg-title').value = link?.title || '';
  wrap.querySelector('#dlg-subject').value = link?.subject || '';
  wrap.querySelector('#dlg-desc').value = link?.description || '';
  wrap.querySelector('#dlg-public').checked = Boolean(link?.isPublic);

  const { hide } = showModal(wrap);
  setTimeout(() => wrap.querySelector('#dlg-url').focus(), 30);
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);

  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    let url = wrap.querySelector('#dlg-url').value.trim();
    const title = wrap.querySelector('#dlg-title').value.trim();
    const subject = wrap.querySelector('#dlg-subject').value.trim() || 'Général';
    const description = wrap.querySelector('#dlg-desc').value.trim();
    const isPublic = wrap.querySelector('#dlg-public').checked;

    if (!url) { showToast('Veuillez saisir une URL.', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); }
    catch { showToast('Adresse URL invalide.', 'error'); return; }
    if (!title) { showToast('Veuillez saisir un titre.', 'error'); return; }

    try {
      if (editing) {
        await FirestoreService.updateLink(link.id, { title, url, description, subject, isPublic });
        FirestoreService.logAccess({ uid, documentId: link.id, documentType: 'link', action: 'edit' });
        EventBus.emit('link:saved', { linkId: link.id });
        showToast('Lien mis à jour.', 'success');
      } else {
        const id = await FirestoreService.createLink({ uid, title, url, description, subject, parentId: targetParent, isPublic });
        FirestoreService.logAccess({ uid, documentId: id, documentType: 'link', action: 'create' });
        EventBus.emit('link:saved', { linkId: id });
        showToast('Lien ajouté.', 'success');
      }
      hide();
    } catch (err) {
      console.error('[Explorer] link save failed:', err);
      showToast(`Enregistrement échoué : ${err.message}`, 'error');
    }
  });
}

function openMoveDialog(kind, item) {
  const excluded = kind === 'folder' ? new Set([item.id, ...descendantIds(item.id)]) : new Set();
  const targets = flattenTree(state.folders.filter(f => !excluded.has(f.id)));
  const currentParent = item.parentId || null;

  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Déplacer « ${escapeHtml(displayName(kind, item))} »</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="dlg-dest">Dossier de destination</label>
        <select class="input select" id="dlg-dest">
          <option value="">Racine — Mes fichiers</option>
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
    const dest = wrap.querySelector('#dlg-dest').value || null;
    if (dest === currentParent) { hide(); return; }
    try {
      await moveEntry(kind, item.id, dest);
      hide();
      scheduleReload();
      showToast('Élément déplacé.', 'success');
    } catch (err) {
      console.error('[Explorer] move failed:', err);
      showToast(`Déplacement échoué : ${err.message}`, 'error');
    }
  });
}

/** Flatten folders into `{ id, name, depth }`, roots first, for a select. */
function flattenTree(folders, parentId = null, depth = 0, out = []) {
  folders
    .filter(f => parentOf(f) === parentId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(f => {
      out.push({ id: f.id, name: f.name || 'Sans nom', depth });
      flattenTree(folders, f.id, depth + 1, out);
    });
  return out;
}

function displayName(kind, item) {
  if (kind === 'folder') return item.name || 'ce dossier';
  if (kind === 'link') return item.title || domainOf(item.url);
  return item.title || 'cette fiche';
}

// ---------------------------------------------------------------------------
// Sharing (folder grants — recipients inherit the whole subtree)
// ---------------------------------------------------------------------------

/** Directory entries the current user may share with, sorted by name. */
function shareableUsers() {
  const self = AppState.user?.uid;
  return state.directory
    .filter(d => (d.id || d.uid) !== self)
    .map(d => ({
      uid: d.id || d.uid,
      name: d.displayName || d.email || d.id || d.uid,
      email: d.email || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Read-only list of recipient names (used by Properties). */
function shareRecipientsHtml(uids) {
  if (!uids?.length) return '';
  return uids.map(uid => `<span class="share-chip">${escapeHtml(userLabel(uid))}</span>`).join(' ');
}

/**
 * "Share" dialog (Drive-style): tick the accounts that may see this folder and
 * everything nested inside it. Only the owner (or an admin) can open it.
 */
function openShareDialog(folder) {
  if (!folder) return;
  const current = new Set(Array.isArray(folder.sharedWith) ? folder.sharedWith : []);
  const users = shareableUsers();

  const row = u => `
    <label class="share-dialog__user" data-name="${escapeAttr(`${u.name} ${u.email}`.toLowerCase())}">
      <input type="checkbox" value="${escapeAttr(u.uid)}" ${current.has(u.uid) ? 'checked' : ''}>
      <span class="share-dialog__name">${escapeHtml(u.name)}</span>
      ${u.email ? `<span class="share-dialog__email">${escapeHtml(u.email)}</span>` : ''}
    </label>`;

  // Recipients that are no longer (or never) in the directory stay editable.
  const orphans = [...current].filter(uid => !users.some(u => u.uid === uid));

  const wrap = document.createElement('div');
  wrap.className = 'dialog share-dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Partager « ${escapeHtml(folder.name || 'Sans nom')} »</h3>

    ${users.length ? `
      <div class="share-dialog__search">
        ${iconImg('search', { size: 16, alt: '' })}
        <input type="text" class="input input--search" id="dlg-share-search" placeholder="Rechercher une personne…">
      </div>` : ''}

    <div class="share-dialog__list" id="dlg-share-list">
      ${[...orphans.map(uid => row({ uid, name: uid, email: '' })), ...users.map(row)].join('') ||
        '<p class="share-dialog__hint">Aucun compte disponible.</p>'}
    </div>

    <p class="share-dialog__hint">
      Les personnes sélectionnées pourront consulter ce dossier et tout son contenu.
      Vous restez le seul à pouvoir le modifier.
    </p>

    ${users.length ? '' : `
      <p class="share-dialog__hint">
        L'annuaire est vide : demandez à un administrateur de le synchroniser pour
        pouvoir choisir des destinataires.
      </p>`}

    <div class="form-actions">
      <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
      <button type="button" class="btn btn--primary" data-action="save">Enregistrer</button>
    </div>
  `;

  const { hide } = showModal(wrap);

  const search = wrap.querySelector('#dlg-share-search');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    wrap.querySelectorAll('.share-dialog__user').forEach(el => {
      el.hidden = Boolean(q) && !el.dataset.name.includes(q);
    });
  });

  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);

  wrap.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const picked = [...wrap.querySelectorAll('#dlg-share-list input[type="checkbox"]:checked')].map(c => c.value);
    try {
      showToast('Mise à jour du partage…', 'info');
      await FirestoreService.setFolderShares({
        folderId: folder.id,
        sharedWith: picked,
        ownerUid: folder.uid,
        ownerName: AppState.user?.displayName || AppState.user?.email || ''
      });
      hide();
      EventBus.emit('share:updated', { folderId: folder.id, sharedWith: picked });
      scheduleReload();
      showToast(picked.length ? `Partagé avec ${picked.length} personne(s).` : 'Partage retiré.', 'success');
    } catch (err) {
      console.error('[Explorer] share failed:', err);
      showToast(`Partage échoué : ${err.message}`, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Properties (Windows-style info panel)
// ---------------------------------------------------------------------------

function kindLabel(kind) {
  return { folder: 'Dossier de fichiers', note: 'Fiche Markdown', link: 'Lien web' }[kind] || 'Élément';
}

/** Human-readable location, e.g. "Mes fichiers / Cours / Maths". */
function locationOf(item) {
  const place = PLACE[state.tab] || PLACE.mine;
  const parts = folderPath(item?.parentId || null).map(f => f.name || 'Sans nom');
  return [place.label, ...parts].join(' / ');
}

/** Recursive totals for a folder and everything nested inside it (current place). */
function folderStats(folderId) {
  const folders = activeFolders();
  const ids = new Set([folderId, ...descendantIds(folderId, folders)]);
  return {
    folders: ids.size - 1,
    notes: activeNotes().filter(n => ids.has(n.parentId)).length,
    links: activeLinks().filter(l => ids.has(l.parentId)).length
  };
}

/** Full French date + time, e.g. "18 octobre 2026 à 14:03". */
function formatFullDate(ts) {
  const ms = millis(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function propRow(label, value) {
  return `<div class="props__row">
    <dt class="props__key">${escapeHtml(label)}</dt>
    <dd class="props__val">${value || '—'}</dd>
  </div>`;
}

/** Windows-style "Properties" dialog for a folder, fiche or link. */
function openPropertiesDialog(kind, item) {
  if (!item) return;

  const canManage = AppState.user && item.uid === AppState.user.uid;
  const ownerName = canManage
    ? (AppState.user.displayName || AppState.user.email || 'Vous')
    : (item.ownerName || userLabel(item.uid) || 'Autre utilisateur');

  const sharedWith = Array.isArray(item.sharedWith) ? item.sharedWith : [];
  const isShared = sharedWith.length > 0;

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
    const visibility = item.isPublic === true
      ? 'Publique (tout le contenu)'
      : item.hasPublic === true ? 'Contient du contenu public' : 'Privée';
    rows.push(propRow('Visibilité', escapeHtml(visibility)));
    rows.push(propRow('Créé le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifié le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  } else if (kind === 'note') {
    const content = item.content || '';
    const count = item.charCount ?? content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const sizeText = `${count.toLocaleString('fr-FR')} caractères · ${words.toLocaleString('fr-FR')} mot${words === 1 ? '' : 's'}`;
    rows.push(propRow('Taille', escapeHtml(sizeText)));
    rows.push(propRow('Matière', escapeHtml(item.subject || 'Général')));
    if (item.topic) rows.push(propRow('Sujet', escapeHtml(item.topic)));
    rows.push(propRow('Visibilité', escapeHtml(item.isPublic ? 'Publique' : 'Privée')));
    rows.push(propRow('Créée le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifiée le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  } else {
    const domain = domainOf(item.url);
    rows.push(propRow('Adresse',
      `<a class="props__link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>`));
    rows.push(propRow('Domaine', escapeHtml(domain)));
    rows.push(propRow('Matière', escapeHtml(item.subject || 'Général')));
    if (item.description) rows.push(propRow('Description', escapeHtml(item.description)));
    rows.push(propRow('Visibilité', escapeHtml(item.isPublic ? 'Publique' : 'Privée')));
    rows.push(propRow('Créé le', escapeHtml(formatFullDate(item.createdAt))));
    rows.push(propRow('Modifié le', escapeHtml(formatFullDate(item.updatedAt || item.createdAt))));
  }

  rows.push(propRow('Propriétaire', escapeHtml(ownerName)));
  if (isShared) {
    rows.push(propRow('Partagé avec', shareRecipientsHtml(sharedWith)));
  }

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
      ${kind === 'folder' && canManage ? `<button type="button" class="btn btn--secondary" data-action="share">${iconImg('share', { size: 16, alt: '' })}<span>Partager</span></button>` : ''}
      ${kind !== 'folder' ? `<button type="button" class="btn btn--secondary" data-action="open">${iconImg('edit', { size: 16, alt: '' })}<span>Ouvrir</span></button>` : ''}
      <button type="button" class="btn btn--primary" data-action="close">Fermer</button>
    </div>
  `;

  const { hide } = showModal(wrap);
  wrap.querySelector('[data-action="close"]')?.addEventListener('click', hide);
  wrap.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyText(item.url, 'URL copiée.'));
  wrap.querySelector('[data-action="share"]')?.addEventListener('click', () => { hide(); openShareDialog(item); });
  wrap.querySelector('[data-action="open"]')?.addEventListener('click', () => {
    hide();
    if (kind === 'note') openNote(item.id);
    else if (kind === 'link' && item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
  });
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

async function refreshQuota() {
  const text = state.container?.querySelector('#fe-quota-text');
  const fill = state.container?.querySelector('#fe-quota-fill');
  if (!text || !fill) return;

  const uid = AppState.user?.uid;
  if (!uid) {
    text.textContent = 'Connectez-vous pour suivre votre quota';
    fill.style.width = '0%';
    return;
  }

  try {
    const quota = await QuotaManager.getQuotaInfo(uid);
    const { usedFormatted, limitFormatted, percentage } = QuotaManager.formatQuota(quota.used, quota.limit);
    text.textContent = `${usedFormatted} / ${limitFormatted} caractères (${percentage}%)`;
    fill.style.width = `${percentage}%`;
    fill.className = 'quota-bar__fill'
      + (percentage >= 90 ? ' quota-bar__fill--danger' : percentage >= 70 ? ' quota-bar__fill--warning' : '');
  } catch (err) {
    console.error('[Explorer] quota failed:', err);
    text.textContent = 'Quota indisponible';
  }
}

// ---------------------------------------------------------------------------
// Bus + utils
// ---------------------------------------------------------------------------

function bindBus() {
  // Guard against duplicate listeners if render() runs again on an open panel.
  state.handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
  state.handlers = [];

  const onNotesSaved = () => scheduleReload();
  const onDeleted = () => scheduleReload();
  const onLinks = () => scheduleReload();
  const onShares = () => scheduleReload();
  const onQuota = () => refreshQuota();

  EventBus.on('note:saved', onNotesSaved);
  EventBus.on('note:deleted', onDeleted);
  EventBus.on('link:saved', onLinks);
  EventBus.on('link:deleted', onLinks);
  EventBus.on('share:updated', onShares);
  EventBus.on('quota:updated', onQuota);
  state.handlers.push(
    ['note:saved', onNotesSaved],
    ['note:deleted', onDeleted],
    ['link:saved', onLinks],
    ['link:deleted', onLinks],
    ['share:updated', onShares],
    ['quota:updated', onQuota]
  );
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'externe'; }
}

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

/** Tear down. */
export function destroy() {
  state.handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
  state.handlers = [];
  clearTimeout(state.reloadTimer);
  closeContextMenu();
  state.container = null;
  state.folders = [];
  state.notes = [];
  state.links = [];
  state.publicLinks = [];
  state.publicNotes = [];
  state.sharedFolders = [];
  state.sharedNotes = [];
  state.sharedLinks = [];
  state.directory = [];
  state.expanded = new Set();
  state.subjects = [];
  state.subject = 'all';
  state.selection = null;
  state.currentFolderId = null;
}
