/**
 * Fiches & Cloud — File Explorer.
 *
 * A hierarchical file manager for the signed-in user: folders that contain
 * sub-folders, Markdown **fiches** and **links**. Supports navigation (breadcrumb),
 * creation / rename / move / delete, drag-and-drop PDF/DOCX import, a public-notes
 * view, search / filter / sort and a live storage-quota indicator.
 *
 * Links are managed here — the former standalone link app has been folded in.
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
  tab: 'mine',            // 'mine' | 'public'
  view: 'list',           // 'list' | 'grid'
  subject: 'all',
  sort: 'date-desc',
  query: '',
  currentFolderId: null,  // null = root
  folders: [],
  notes: [],
  links: [],
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
      <div class="file-explorer__header">
        <div class="file-explorer__tabs">
          <button class="tab-btn ${state.tab === 'mine' ? 'tab-btn--active' : ''}" data-tab="mine">
            ${iconImg(ICON_FOLDER, { size: 18, alt: '', className: 'tab-btn__icon' })}Mes fichiers
          </button>
          <button class="tab-btn ${state.tab === 'public' ? 'tab-btn--active' : ''}" data-tab="public">
            ${iconImg('bookmark', { size: 18, alt: '', className: 'tab-btn__icon' })}Fiches publiques
          </button>
          <button class="tab-btn ${state.tab === 'public-links' ? 'tab-btn--active' : ''}" data-tab="public-links">
            ${iconImg('link', { size: 18, alt: '', className: 'tab-btn__icon' })}Liens publics
          </button>
        </div>
        <button class="btn btn--primary" id="fe-new" type="button" aria-haspopup="menu">
          ${iconImg('add', { size: 18, alt: '' })}<span>Nouveau</span><span class="btn__caret" aria-hidden="true"></span>
        </button>
      </div>

      <nav class="file-explorer__breadcrumb" id="fe-breadcrumb" aria-label="Chemin"></nav>

      <div class="file-explorer__toolbar">
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

      <div class="file-explorer__body" id="fe-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement…</p></div>
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
  await Promise.all([loadData(), refreshQuota()]);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function bindToolbar() {
  const c = state.container;

  c.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tab = btn.dataset.tab;
      if (tab === state.tab) return;
      state.tab = tab;
      state.currentFolderId = null;
      state.selection = null;
      c.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b === btn));
      updateChrome();
      await loadData();
    });
  });

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

/** Show/hide chrome that only applies to the personal "Mes fichiers" tab. */
function updateChrome() {
  const c = state.container;
  const mine = state.tab === 'mine';
  c.querySelector('#fe-new')?.toggleAttribute('hidden', !mine);
  c.querySelector('#fe-drop')?.toggleAttribute('hidden', !mine);
  const bc = c.querySelector('#fe-breadcrumb');
  if (bc) bc.hidden = !mine;
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

  try {
    const uid = AppState.user?.uid;
    if (state.tab === 'public') {
      state.folders = [];
      state.links = [];
      state.notes = await FirestoreService.getPublicNotes({});
    } else if (state.tab === 'public-links') {
      state.folders = [];
      state.notes = [];
      state.links = await FirestoreService.getPublicLinks({});
    } else if (uid) {
      // Each collection loads independently: a denial or index error on one
      // (e.g. a missing `folders` rule) must not blank out the whole explorer.
      const failures = [];
      const safe = (label, p) => p.catch(err => {
        console.warn(`[Explorer] ${label} load failed:`, err.message);
        failures.push(label);
        return [];
      });
      const [folders, notes, links] = await Promise.all([
        safe('dossiers', FirestoreService.getUserFolders(uid)),
        safe('fiches', FirestoreService.getUserNotes(uid)),
        safe('liens', FirestoreService.getUserLinks(uid))
      ]);
      state.folders = folders;
      state.notes = notes;
      state.links = links;

      if (failures.length) {
        showToast(
          `Certaines données sont indisponibles (${failures.join(', ')}). ` +
          'Vérifiez les règles de sécurité Firestore.',
          'error'
        );
      }
    } else {
      state.folders = []; state.notes = []; state.links = [];
    }

    if (state.currentFolderId && !state.folders.some(f => f.id === state.currentFolderId)) {
      state.currentFolderId = null;
    }

    const subjects = new Set();
    state.notes.forEach(n => { if (n.subject?.trim()) subjects.add(n.subject.trim()); });
    state.links.forEach(l => { if (l.subject?.trim()) subjects.add(l.subject.trim()); });
    state.subjects = [...subjects].sort();

    populateSubjectFilter();
    renderBreadcrumb();
    renderList();
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
// Breadcrumb
// ---------------------------------------------------------------------------

function parentOf(item) { return item.parentId || null; }

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
  const nav = state.container?.querySelector('#fe-breadcrumb');
  if (!nav) return;
  if (state.tab !== 'mine') { nav.hidden = true; nav.innerHTML = ''; return; }

  nav.hidden = false;
  const path = folderPath(state.currentFolderId);
  const parts = [
    `<button type="button" class="breadcrumb__crumb" data-folder="">
      ${iconImg(ICON_FOLDER, { size: 15, alt: '' })}<span>Mes fichiers</span>
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

function childrenOf(folderId) {
  return {
    folders: state.folders.filter(f => parentOf(f) === folderId),
    notes: state.notes.filter(n => parentOf(n) === folderId),
    links: state.links.filter(l => parentOf(l) === folderId)
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

  // The public tabs list everything flat (no folder hierarchy).
  const { folders, notes, links } = state.tab === 'mine'
    ? childrenOf(state.currentFolderId)
    : { folders: [], notes: state.notes, links: state.links };

  const shownFolders = folders
    .filter(f => matchesQuery(f, ['name']))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let files = [
    ...notes.filter(n => matchesSubject(n) && matchesQuery(n, ['title', 'subject', 'topic', 'content']))
      .map(data => ({ kind: 'note', id: data.id, data })),
    ...links.filter(l => matchesSubject(l) && matchesQuery(l, ['title', 'url', 'description', 'subject']))
      .map(data => ({ kind: 'link', id: data.id, data }))
  ];
  files = sortFiles(files);

  state.selection = null;

  if (shownFolders.length === 0 && files.length === 0) {
    body.innerHTML = emptyStateHtml();
    body.querySelector('#fe-empty-new-folder')?.addEventListener('click', () => openFolderDialog({ parentId: state.currentFolderId }));
    body.querySelector('#fe-empty-new-note')?.addEventListener('click', () => openNewNote());
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
    return `
      <div class="empty-state">
        ${iconImg('document', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Aucune fiche publique</h3>
        <p class="empty-state__description">Revenez plus tard ou rendez une de vos fiches publique.</p>
      </div>`;
  }

  if (state.tab === 'public-links') {
    return `
      <div class="empty-state">
        ${iconImg('link', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Aucun lien public</h3>
        <p class="empty-state__description">Revenez plus tard ou rendez un de vos liens public.</p>
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
        const data = kind === 'folder' ? state.folders.find(f => f.id === id) : kind === 'note' ? state.notes.find(n => n.id === id) : state.links.find(l => l.id === id);
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

function activate(kind, id) {
  if (kind === 'folder') { enterFolder(id); return; }
  if (kind === 'note') { EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId: id } }); return; }
  if (kind === 'link') {
    const link = state.links.find(l => l.id === id);
    if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer');
  }
}

function enterFolder(folderId) {
  state.currentFolderId = folderId || null;
  state.selection = null;
  renderBreadcrumb();
  renderList();
  state.container?.querySelector('#fe-body')?.scrollTo?.({ top: 0 });
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
  return [
    { label: 'Nouveau dossier', icon: 'add-folder', onSelect: () => openFolderDialog({ parentId: state.currentFolderId }) },
    { label: 'Nouvelle fiche', icon: 'document', shortcut: 'Ctrl+N', onSelect: () => openNewNote() },
    { label: 'Nouveau lien', icon: 'link', onSelect: () => openLinkDialog() },
    { label: 'Importer un fichier (PDF/DOCX)…', icon: 'import', onSelect: () => browseForFile() },
    { separator: true },
    { label: 'Rafraîchir', icon: 'refresh', onSelect: () => { scheduleReload(); showToast('Explorateur rafraîchi.', 'info'); } },
    { separator: true },
    { label: 'Affichage', icon: ICON_GRID, submenu: viewSubmenu },
    { label: 'Trier par', icon: 'sorting-arrows', submenu: sortSubmenu }
  ];
}

function itemMenu(sel) {
  if (sel.kind === 'folder') return folderMenuItems(state.folders.find(f => f.id === sel.id));
  if (sel.kind === 'note') return noteMenuItems(state.notes.find(n => n.id === sel.id));
  return linkMenuItems(state.links.find(l => l.id === sel.id));
}

function folderMenuItems(folder) {
  if (!folder) return [];
  return [
    { label: 'Ouvrir', icon: ICON_FOLDER, onSelect: () => enterFolder(folder.id) },
    { label: 'Renommer', icon: 'edit', onSelect: () => openFolderDialog({ folder }) },
    { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('folder', folder) },
    { separator: true },
    { label: 'Nouvelle fiche', icon: 'document', onSelect: () => openNewNote(folder.id) },
    { label: 'Nouveau lien', icon: 'link', onSelect: () => openLinkDialog(null, folder.id) },
    { separator: true },
    { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteFolder(folder) },
    { separator: true },
    { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('folder', folder) }
  ];
}

function noteMenuItems(note) {
  if (!note) return [];
  const owner = AppState.user && note.uid === AppState.user.uid;
  const items = [{ label: 'Ouvrir', icon: 'document', onSelect: () => openNote(note.id) }];
  if (owner) {
    items.push(
      { label: 'Renommer', icon: 'edit', onSelect: () => renameNote(note) },
      { label: 'Dupliquer', icon: 'copy', onSelect: () => duplicateNote(note) },
      { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('note', note) },
      { label: note.isPublic ? 'Rendre privée' : 'Rendre publique', icon: note.isPublic ? 'lock' : 'unlock', onSelect: () => togglePublic(note) },
      { separator: true },
      { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteEntry('note', note.id) },
      { separator: true },
      { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('note', note) }
    );
  } else {
    items.push(
      { separator: true },
      { label: 'Copier le titre', icon: 'copy', onSelect: () => copyText(note.title || 'Sans titre', 'Titre copié.') },
      { separator: true },
      { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('note', note) }
    );
  }
  return items;
}

function linkMenuItems(link) {
  if (!link) return [];
  const owner = AppState.user && link.uid === AppState.user.uid;
  const items = [
    { label: 'Ouvrir dans un onglet', icon: 'external-link', onSelect: () => window.open(link.url, '_blank', 'noopener,noreferrer') },
    { label: 'Copier l’URL', icon: 'copy', onSelect: () => copyText(link.url, 'URL copiée.') }
  ];
  if (owner) {
    items.push(
      { label: 'Modifier', icon: 'edit', onSelect: () => openLinkDialog(link) },
      { label: 'Déplacer vers…', icon: 'move', onSelect: () => openMoveDialog('link', link) },
      { label: link.isPublic ? 'Rendre privé' : 'Rendre public', icon: link.isPublic ? 'lock' : 'unlock', onSelect: () => toggleLinkPublic(link) },
      { separator: true },
      { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteEntry('link', link.id) }
    );
  }
  items.push(
    { separator: true },
    { label: 'Propriétés', icon: 'info', onSelect: () => openPropertiesDialog('link', link) }
  );
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
    EventBus.emit('link:deleted', { linkId });
    showToast('Lien supprimé.', 'success');
  } catch (err) {
    console.error('[Explorer] delete link failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

/** Ids of every folder nested (directly or not) inside `folderId`. */
function descendantIds(folderId) {
  const ids = new Set();
  const walk = id => {
    state.folders.forEach(f => {
      if (parentOf(f) === id && !ids.has(f.id)) { ids.add(f.id); walk(f.id); }
    });
  };
  walk(folderId);
  return ids;
}

async function deleteFolder(folder) {
  const ids = new Set([folder.id, ...descendantIds(folder.id)]);
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

async function togglePublic(note) {
  const uid = AppState.user?.uid;
  try {
    const next = !note.isPublic;
    await FirestoreService.updateNote(note.id, { isPublic: next });
    if (uid) FirestoreService.logAccess({ uid, documentId: note.id, documentType: 'note', action: 'edit' });
    EventBus.emit('note:saved', { noteId: note.id });
    showToast(next ? 'Fiche rendue publique.' : 'Fiche rendue privée.', 'success');
  } catch (err) {
    console.error('[Explorer] toggle public failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
  }
}

async function toggleLinkPublic(link) {
  const uid = AppState.user?.uid;
  try {
    const next = !link.isPublic;
    await FirestoreService.updateLink(link.id, { isPublic: next });
    if (uid) FirestoreService.logAccess({ uid, documentId: link.id, documentType: 'link', action: 'edit' });
    EventBus.emit('link:saved', { linkId: link.id });
    showToast(next ? 'Lien rendu public.' : 'Lien rendu privé.', 'success');
  } catch (err) {
    console.error('[Explorer] toggle link public failed:', err);
    showToast(`Modification échouée : ${err.message}`, 'error');
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

/** Generic single-field text dialog (folder create/rename, note rename). */
function openTextDialog({ title, label, value = '', onSave }) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog card';
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
  wrap.className = 'dialog card';
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
  wrap.className = 'dialog card';
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
// Properties (Windows-style info panel)
// ---------------------------------------------------------------------------

function kindLabel(kind) {
  return { folder: 'Dossier de fichiers', note: 'Fiche Markdown', link: 'Lien web' }[kind] || 'Élément';
}

/** Human-readable location, e.g. "Mes fichiers / Cours / Maths". */
function locationOf(item) {
  const parts = folderPath(item?.parentId || null).map(f => f.name || 'Sans nom');
  return ['Mes fichiers', ...parts].join(' / ');
}

/** Recursive totals for a folder and everything nested inside it. */
function folderStats(folderId) {
  const ids = new Set([folderId, ...descendantIds(folderId)]);
  return {
    folders: ids.size - 1,
    notes: state.notes.filter(n => ids.has(n.parentId)).length,
    links: state.links.filter(l => ids.has(l.parentId)).length
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
    : 'Autre utilisateur';

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
      ${kind !== 'folder' && canManage ? `<button type="button" class="btn btn--secondary" data-action="open">${iconImg('edit', { size: 16, alt: '' })}<span>Ouvrir</span></button>` : ''}
      <button type="button" class="btn btn--primary" data-action="close">Fermer</button>
    </div>
  `;

  const { hide } = showModal(wrap);
  wrap.querySelector('[data-action="close"]')?.addEventListener('click', hide);
  wrap.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyText(item.url, 'URL copiée.'));
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
  const onQuota = () => refreshQuota();

  EventBus.on('note:saved', onNotesSaved);
  EventBus.on('note:deleted', onDeleted);
  EventBus.on('link:saved', onLinks);
  EventBus.on('link:deleted', onLinks);
  EventBus.on('quota:updated', onQuota);
  state.handlers.push(
    ['note:saved', onNotesSaved],
    ['note:deleted', onDeleted],
    ['link:saved', onLinks],
    ['link:deleted', onLinks],
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
  state.selection = null;
  state.currentFolderId = null;
}
