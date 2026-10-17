/**
 * Fiches & Cloud — File Explorer.
 *
 * Browses personal and public notes with search / filter / sort, drag-and-drop
 * PDF/DOCX import, note deletion and a live storage-quota indicator.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast, showModal, iconImg } from '../app.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';

const state = {
  container: null,
  tab: 'mine',        // 'mine' | 'public'
  view: 'list',       // 'list' | 'grid'
  subject: 'all',
  sort: 'date-desc',
  query: '',
  notes: [],
  subjects: [],
  selectedId: null,
  handlers: []
};

/**
 * @param {HTMLElement} container
 */
export async function render(container) {
  state.container = container;
  container.classList.add('file-explorer-container');

  container.innerHTML = `
    <div class="file-explorer">
      <div class="file-explorer__header">
        <div class="file-explorer__tabs">
          <button class="tab-btn ${state.tab === 'mine' ? 'tab-btn--active' : ''}" data-tab="mine">
            ${iconImg('folder', { size: 18, alt: '', className: 'tab-btn__icon' })}Mes fiches
          </button>
          <button class="tab-btn ${state.tab === 'public' ? 'tab-btn--active' : ''}" data-tab="public">
            ${iconImg('bookmark', { size: 18, alt: '', className: 'tab-btn__icon' })}Fiches publiques
          </button>
        </div>
        <button class="btn btn--primary" id="fe-new" type="button" aria-haspopup="menu">
          ${iconImg('add', { size: 18, alt: '' })}<span>Nouveau</span><span class="btn__caret" aria-hidden="true"></span>
        </button>
      </div>

      <div class="file-explorer__toolbar">
        <div class="search-field">
          ${iconImg('search', { size: 18, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="fe-search"
                 placeholder="Rechercher par titre, matière ou contenu…" value="${escapeAttr(state.query)}">
          <button type="button" class="btn-clear" id="fe-clear" ${state.query ? '' : 'hidden'}>&times;</button>
        </div>

        <div class="file-explorer__filters">
          <select class="input select" id="fe-subject" aria-label="Filtrer par matière">
            <option value="all">Toutes les matières</option>
          </select>
          <select class="input select" id="fe-sort" aria-label="Trier">
            <option value="date-desc" ${state.sort === 'date-desc' ? 'selected' : ''}>Plus récentes</option>
            <option value="date-asc" ${state.sort === 'date-asc' ? 'selected' : ''}>Plus anciennes</option>
            <option value="title-asc" ${state.sort === 'title-asc' ? 'selected' : ''}>Titre (A→Z)</option>
            <option value="title-desc" ${state.sort === 'title-desc' ? 'selected' : ''}>Titre (Z→A)</option>
            <option value="subject-asc" ${state.sort === 'subject-asc' ? 'selected' : ''}>Matière (A→Z)</option>
          </select>
          <div class="view-toggle">
            <button class="view-toggle__btn ${state.view === 'list' ? 'view-toggle__btn--active' : ''}" id="fe-view-list" title="Liste" aria-label="Vue liste">
              ${iconImg('list', { size: 18, alt: '' })}
            </button>
            <button class="view-toggle__btn ${state.view === 'grid' ? 'view-toggle__btn--active' : ''}" id="fe-view-grid" title="Grille" aria-label="Vue grille">
              ${iconImg('grid', { size: 18, alt: '' })}
            </button>
          </div>
        </div>
      </div>

      <div class="file-explorer__body" id="fe-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement des fiches…</p></div>
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
  bindContextMenu();
  bindBus();
  await Promise.all([loadNotes(), refreshQuota()]);
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
      c.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-btn--active', b === btn));
      await loadNotes();
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
      params: { importedContent: result.markdown, importedTitle: result.title || 'Document importé' }
    });
  } catch (err) {
    console.error('[Explorer] conversion failed:', err);
    showToast(`Conversion échouée : ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadNotes() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;

  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement des fiches…</p></div>`;

  try {
    const uid = AppState.user?.uid;
    if (state.tab === 'mine') {
      state.notes = uid ? await FirestoreService.getUserNotes(uid, {}) : [];
    } else {
      state.notes = await FirestoreService.getPublicNotes({});
    }

    const subjects = new Set();
    state.notes.forEach(n => { if (n.subject?.trim()) subjects.add(n.subject.trim()); });
    state.subjects = [...subjects].sort();

    populateSubjectFilter();
    renderList();
  } catch (err) {
    console.error('[Explorer] load failed:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Chargement impossible</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="fe-retry">Réessayer</button>
      </div>`;
    body.querySelector('#fe-retry')?.addEventListener('click', loadNotes);
  }
}

function populateSubjectFilter() {
  const select = state.container?.querySelector('#fe-subject');
  if (!select) return;
  select.innerHTML = '<option value="all">Toutes les matières</option>' +
    state.subjects.map(s => `<option value="${escapeAttr(s)}" ${state.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
}

function renderList() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;

  const filtered = state.notes.filter(note => {
    if (state.subject !== 'all' && (note.subject || '').trim() !== state.subject) return false;
    if (!state.query) return true;
    const q = state.query;
    return ['title', 'subject', 'topic', 'content'].some(k => (note[k] || '').toLowerCase().includes(q));
  });

  const [field, dir] = state.sort.split('-');
  filtered.sort((a, b) => {
    let cmp = 0;
    if (field === 'date') {
      cmp = millis(a.updatedAt || a.createdAt) - millis(b.updatedAt || b.createdAt);
    } else if (field === 'title') {
      cmp = (a.title || '').localeCompare(b.title || '');
    } else if (field === 'subject') {
      cmp = (a.subject || '').localeCompare(b.subject || '');
    }
    return dir === 'desc' ? -cmp : cmp;
  });

  if (filtered.length === 0) {
    body.innerHTML = emptyStateHtml();
    body.querySelector('#fe-empty-new')?.addEventListener('click', openNewNote);
    return;
  }

  body.innerHTML = state.view === 'grid'
    ? `<div class="file-grid">${filtered.map(gridCard).join('')}</div>`
    : `<div class="file-list">${filtered.map(listRow).join('')}</div>`;

  body.querySelectorAll('[data-note-id]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.btn-delete')) return;
      const noteId = el.dataset.noteId;
      if (!noteId) return;
      EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId } });
    });
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.btn-delete')) return;
      const noteId = el.dataset.noteId;
      if (!noteId) return;
      EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId } });
    });
  });

  body.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteNote(btn.dataset.noteId);
    });
  });
}

function emptyStateHtml() {
  const searching = Boolean(state.query) || state.subject !== 'all';
  const title = searching
    ? 'Aucune fiche ne correspond'
    : (state.tab === 'mine' ? 'Aucune fiche pour le moment' : 'Aucune fiche publique');
  const desc = searching
    ? 'Effacez la recherche ou réinitialisez le filtre de matière.'
    : (state.tab === 'mine'
      ? 'Créez votre première fiche ou déposez un PDF/DOCX ci-dessus.'
      : 'Revenez plus tard ou rendez une de vos fiches publique.');

  return `
    <div class="empty-state">
      ${iconImg('document', { size: 48, alt: '', className: 'empty-state__icon' })}
      <h3 class="empty-state__title">${title}</h3>
      <p class="empty-state__description">${desc}</p>
      ${(state.tab === 'mine' && !searching)
        ? `<button class="btn btn--primary" id="fe-empty-new">${iconImg('add', { size: 18, alt: '' })}<span>Créer une fiche</span></button>`
        : ''}
    </div>`;
}

function gridCard(note) {
  const owner = AppState.user && note.uid === AppState.user.uid;
  return `
    <article class="file-card" data-note-id="${note.id}" tabindex="0">
      <div class="file-card__header">
        ${iconImg('document', { size: 32, alt: '', className: 'file-card__icon' })}
        <div class="file-card__badges">
          <span class="badge badge--subject">${escapeHtml(note.subject || 'Général')}</span>
          ${note.isPublic ? '<span class="badge badge--public">Public</span>' : ''}
        </div>
      </div>
      <h4 class="file-card__title">${escapeHtml(note.title || 'Sans titre')}</h4>
      ${note.topic ? `<p class="file-card__topic">${escapeHtml(note.topic)}</p>` : ''}
      <div class="file-card__footer">
        <div class="file-card__meta">
          <span>${charLabel(note)}</span>
          <span>${formatDate(note.updatedAt || note.createdAt)}</span>
        </div>
        ${owner ? deleteBtn(note.id) : ''}
      </div>
    </article>`;
}

function listRow(note) {
  const owner = AppState.user && note.uid === AppState.user.uid;
  return `
    <div class="file-item" data-note-id="${note.id}" tabindex="0" role="button">
      ${iconImg('document', { size: 24, alt: '', className: 'file-item__icon' })}
      <div class="file-item__info">
        <div class="file-item__row">
          <span class="file-item__title">${escapeHtml(note.title || 'Sans titre')}</span>
          <span class="badge badge--subject">${escapeHtml(note.subject || 'Général')}</span>
          ${note.topic ? `<span class="badge badge--topic">${escapeHtml(note.topic)}</span>` : ''}
          ${note.isPublic ? '<span class="badge badge--public">Public</span>' : ''}
        </div>
        <div class="file-item__meta">${charLabel(note)} &middot; Modifiée ${formatDate(note.updatedAt || note.createdAt)}</div>
      </div>
      <div class="file-item__actions">${owner ? deleteBtn(note.id) : ''}</div>
    </div>`;
}

function deleteBtn(id) {
  return `<button type="button" class="btn btn--icon btn--danger btn-delete" data-note-id="${id}" title="Supprimer" aria-label="Supprimer la fiche">
    ${iconImg('delete', { size: 16, alt: '' })}
  </button>`;
}

async function deleteNote(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!confirm(`Supprimer définitivement « ${note?.title || 'cette fiche'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    await FirestoreService.deleteNote(noteId);
    if (uid) FirestoreService.logAccess({ uid, documentId: noteId, documentType: 'note', action: 'delete' });

    state.notes = state.notes.filter(n => n.id !== noteId);
    EventBus.emit('note:deleted', { noteId });
    showToast('Fiche supprimée.', 'success');
    renderList();
    refreshQuota();
  } catch (err) {
    console.error('[Explorer] delete failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
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
  const onSaved = async () => { await loadNotes(); await refreshQuota(); };
  const onDeleted = () => refreshQuota();
  const onQuota = () => refreshQuota();

  EventBus.on('note:saved', onSaved);
  EventBus.on('note:deleted', onDeleted);
  EventBus.on('quota:updated', onQuota);
  state.handlers.push(['note:saved', onSaved], ['note:deleted', onDeleted], ['quota:updated', onQuota]);
}

function charLabel(note) {
  const count = note.charCount ?? (note.content || '').length;
  return `${count.toLocaleString('fr-FR')} car.`;
}

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function formatDate(ts) {
  const ms = millis(ts);
  if (!ms) return '—';
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function bindContextMenu() {
  const body = state.container?.querySelector('#fe-body');
  if (!body) return;
  body.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    const target = e.target;
    const itemEl = target.closest('[data-note-id]');
    if (itemEl) {
      const note = state.notes.find(n => n.id === itemEl.dataset.noteId);
      if (note) {
        setSelectedNote(note.id);
        showContextMenu(x, y, noteMenuItems(note));
        return;
      }
    }
    setSelectedNote(null);
    showContextMenu(x, y, backgroundMenuItems());
  });
  body.addEventListener('click', () => setSelectedNote(null));
}

function setSelectedNote(id) {
  state.selectedId = id;
  state.container?.querySelectorAll('[data-note-id]').forEach(el => {
    const isItem = el.classList.contains('file-item');
    const isCard = el.classList.contains('file-card');
    const match = el.dataset.noteId === id;
    if (isItem) el.classList.toggle('file-item--selected', match);
    if (isCard) el.classList.toggle('file-card--selected', match);
  });
}

function openNewMenu(anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  showContextMenu(rect.left, rect.bottom + 4, newMenuItems());
}

function newMenuItems() {
  return [
    { label: 'Nouvelle fiche', icon: 'document', shortcut: 'Ctrl+N', onSelect: openNewNote },
    { label: 'Nouveau lien', icon: 'link', onSelect: openNewLink },
    { separator: true },
    { label: 'Importer un fichier (PDF/DOCX)…', icon: 'import', onSelect: browseForFile }
  ];
}

function backgroundMenuItems() {
  const sortSubmenu = [
    { label: 'Plus récentes', checked: state.sort === 'date-desc', onSelect: () => setSort('date-desc') },
    { label: 'Plus anciennes', checked: state.sort === 'date-asc', onSelect: () => setSort('date-asc') },
    { label: 'Titre (A→Z)', checked: state.sort === 'title-asc', onSelect: () => setSort('title-asc') },
    { label: 'Titre (Z→A)', checked: state.sort === 'title-desc', onSelect: () => setSort('title-desc') },
    { label: 'Matière (A→Z)', checked: state.sort === 'subject-asc', onSelect: () => setSort('subject-asc') }
  ];
  const viewSubmenu = [
    { label: 'Liste', icon: 'list', checked: state.view === 'list', onSelect: () => setView('list') },
    { label: 'Grille', icon: 'grid', checked: state.view === 'grid', onSelect: () => setView('grid') }
  ];
  return [
    { label: 'Nouvelle fiche', icon: 'document', shortcut: 'Ctrl+N', onSelect: openNewNote },
    { label: 'Nouveau lien', icon: 'link', onSelect: openNewLink },
    { label: 'Importer un fichier (PDF/DOCX)…', icon: 'import', onSelect: browseForFile },
    { separator: true },
    { label: 'Rafraîchir', icon: 'refresh', onSelect: refresh },
    { separator: true },
    { label: 'Affichage', icon: 'grid', submenu: viewSubmenu },
    { label: 'Trier par', icon: 'sorting-arrows', submenu: sortSubmenu }
  ];
}

function noteMenuItems(note) {
  const owner = AppState.user && note.uid === AppState.user.uid;
  const items = [
    { label: 'Ouvrir', icon: 'document', onSelect: () => openNote(note.id) }
  ];
  if (owner) {
    items.push(
      { label: 'Renommer', icon: 'edit', onSelect: () => renameNote(note) },
      { label: 'Dupliquer', icon: 'copy', onSelect: () => duplicateNote(note) },
      { label: note.isPublic ? 'Rendre privée' : 'Rendre publique', icon: note.isPublic ? 'lock' : 'unlock', onSelect: () => togglePublic(note) },
      { separator: true },
      { label: 'Supprimer', icon: 'delete', danger: true, onSelect: () => deleteNote(note.id) }
    );
  } else {
    items.push(
      { separator: true },
      { label: 'Copier le titre', icon: 'copy', onSelect: () => copyText(note.title || 'Sans titre', 'Titre copié.') }
    );
  }
  return items;
}

function openNewNote() {
  EventBus.emit('app:open', { appId: 'markdown-editor' });
}
function openNewLink() {
  EventBus.emit('app:open', { appId: 'link-manager', params: { newLink: true } });
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
function refresh() {
  loadNotes();
  refreshQuota();
  showToast('Explorateur rafraîchi.', 'info');
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
function renameNote(note) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog card';
  wrap.innerHTML = `
    <h3 class="dialog__title">Renommer la fiche</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="dlg-name">Nom de la fiche</label>
        <input class="input" type="text" id="dlg-name" required placeholder="Titre de la fiche">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Enregistrer</button>
      </div>
    </form>
  `;
  const input = wrap.querySelector('#dlg-name');
  input.value = note.title || '';
  const { hide } = showModal(wrap);
  setTimeout(() => { input.focus(); input.select(); }, 30);
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);
  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) {
      showToast('Le nom ne peut pas être vide.', 'error');
      input.focus();
      return;
    }
    try {
      const uid = AppState.user?.uid;
      await FirestoreService.updateNote(note.id, { title });
      if (uid) FirestoreService.logAccess({ uid, documentId: note.id, documentType: 'note', action: 'edit' });
      hide();
      EventBus.emit('note:saved', { noteId: note.id });
      showToast('Fiche renommée.', 'success');
    } catch (err) {
      console.error('[Explorer] rename failed:', err);
      showToast(`Renommage échoué : ${err.message}`, 'error');
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
      isPublic: false
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

/** Tear down. */
export function destroy() {
  state.handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
  state.handlers = [];
  closeContextMenu();
  state.container = null;
  state.notes = [];
  state.selectedId = null;
}
