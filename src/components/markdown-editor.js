/**
 * Fiches & Cloud — Word-style WYSIWYG editor.
 *
 * The user writes on a paper-like page with a ribbon (styles, emphasis, lists,
 * alignment, inserts) — Markdown is never shown. **Firestore still stores
 * Markdown**: the page HTML is converted with Turndown on save, and Marked
 * renders the stored Markdown when the fiche is opened. An *Aperçu* (reading
 * view) renders KaTeX for math, which stays as `$…$` in the page while editing.
 *
 * Fiches belonging to someone else (public, or shared through a folder) open in
 * **read-only** mode: the Firestore rules only let the owner — or an admin —
 * write, so the editor says so up front instead of failing on save.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast, showModal, iconImg } from '../app.js';

const state = {
  container: null,
  panelId: null,
  noteId: null,
  parentId: null,
  initialChars: 0,
  initialPublic: false,
  noteOwner: null,
  saving: false,
  dirty: false,
  readOnly: false,
  preview: false,
  previewMarkdown: '',
  savedRange: null,
  cleanup: []
};

/** Inline SVG glyphs for the ribbon (no network, no icon-name guessing). */
const RIBBON_ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 0 12h-2"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9h-9a6 6 0 0 0 0 12h2"/>',
  bullets: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  numbers: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5h1v4M3.5 9h2M3.5 13.5c.6-.7 2-.7 2 .3 0 .7-1.3 1.4-2 2.2h2"/>',
  quote: '<path d="M5 7h5v5H6a4 4 0 0 0 4 4"/><path d="M14 7h5v5h-4a4 4 0 0 0 4 4"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  alignJustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M9 5v14"/>',
  rule: '<path d="M4 12h16"/>',
  clear: '<path d="m5 16 7-11 6 4-4 7"/><path d="M9 20h10"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  pencil: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 5.5 3 3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11 7.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
  math: '<path d="M17 5h-8l4.5 7L9 19h8"/><path d="M19 8v8"/>'
};

function ribIcon(name, size = 17) {
  return `<svg class="ribbon-btn__svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RIBBON_ICONS[name] || ''}</svg>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }

/** @param {string} name */
function ribbonBtn(name, label, title, extra = '') {
  return `<button type="button" class="ribbon-btn" ${extra} title="${escapeAttr(title)}">${ribIcon(name)}<span>${escapeHtml(label)}</span></button>`;
}

/**
 * @param {HTMLElement} container
 * @param {{noteId?:string, parentId?:string|null, importedContent?:string, importedTitle?:string}} [params]
 */
export async function render(container, params = {}) {
  state.container = container;
  state.panelId = container.closest('.workspace__panel')?.dataset.panelId || null;
  state.noteId = params.noteId || null;
  state.parentId = params.parentId || null;
  state.dirty = false;
  state.readOnly = false;
  state.preview = false;
  state.previewMarkdown = '';
  state.savedRange = null;
  state.initialChars = 0;
  state.initialPublic = false;
  state.noteOwner = null;
  state.saving = false;

  // Drop listeners from a previous mount, if any.
  state.cleanup.forEach(fn => { try { fn(); } catch { /* noop */ } });
  state.cleanup = [];

  container.classList.add('editor-panel-container');

  container.innerHTML = `
    <div class="word-editor">
      <div class="word-editor__topbar">
        ${iconImg('document', { size: 22, alt: '', className: 'word-editor__fileicon' })}
        <div class="word-editor__filemeta">
          <span class="word-editor__filename" id="ed-filename">Nouvelle fiche</span>
          <span class="word-editor__filepath">Fiches &amp; Cloud</span>
        </div>

        <div class="editor__actions">
          <span class="editor__badge" id="ed-badge" hidden>
            ${iconImg('collaboration', { size: 16, alt: '' })}<span>Lecture seule</span>
          </span>
          <label class="toggle" id="ed-public-toggle" title="Rendre la fiche visible par tous (administrateurs uniquement)" ${AppState.isAdmin === true ? '' : 'hidden'}>
            <input type="checkbox" class="toggle__input" id="ed-public">
            <span class="toggle__slider"></span>
            <span class="toggle__label">Publique</span>
          </label>
          <button type="button" class="btn btn--secondary" id="ed-cancel">Annuler</button>
          ${state.noteId ? `<button type="button" class="btn btn--danger" id="ed-delete">${iconImg('delete', { size: 16, alt: '' })}<span>Supprimer</span></button>` : ''}
          <button type="button" class="btn btn--primary" id="ed-save">${iconImg('save', { size: 16, alt: '' })}<span id="ed-save-label">Enregistrer</span></button>
        </div>
      </div>

      <div class="word-editor__ribbon" id="ed-ribbon" role="toolbar" aria-label="Mise en forme">
        <div class="ribbon-group">
          <div class="ribbon-row">
            <button type="button" class="ribbon-btn" data-cmd="undo" title="Annuler (Ctrl+Z)">${ribIcon('undo')}</button>
            <button type="button" class="ribbon-btn" data-cmd="redo" title="Rétablir (Ctrl+Y)">${ribIcon('redo')}</button>
          </div>
          <span class="ribbon-group__label">Historique</span>
        </div>

        <div class="ribbon-group ribbon-group--styles">
          <div class="ribbon-row">
            <select class="ribbon-select" id="ed-block" aria-label="Style de paragraphe">
              <option value="p">Normal</option>
              <option value="h1">Titre 1</option>
              <option value="h2">Titre 2</option>
              <option value="h3">Titre 3</option>
              <option value="blockquote">Citation</option>
              <option value="pre">Code</option>
            </select>
          </div>
          <span class="ribbon-group__label">Styles</span>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-row">
            <button type="button" class="ribbon-btn ribbon-btn--letter" data-cmd="bold" title="Gras (Ctrl+B)"><b>B</b></button>
            <button type="button" class="ribbon-btn ribbon-btn--letter" data-cmd="italic" title="Italique (Ctrl+I)"><i>I</i></button>
            <button type="button" class="ribbon-btn ribbon-btn--letter" data-cmd="underline" title="Souligné (Ctrl+U)"><u>S</u></button>
            <button type="button" class="ribbon-btn ribbon-btn--letter" data-cmd="strikeThrough" title="Barré"><s>S</s></button>
          </div>
          <span class="ribbon-group__label">Police</span>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-row">
            <button type="button" class="ribbon-btn" data-cmd="insertUnorderedList" title="Liste à puces">${ribIcon('bullets')}</button>
            <button type="button" class="ribbon-btn" data-cmd="insertOrderedList" title="Liste numérotée">${ribIcon('numbers')}</button>
            <button type="button" class="ribbon-btn" data-cmd="formatBlock" data-value="blockquote" title="Citation">${ribIcon('quote')}</button>
            <span class="ribbon-sep" aria-hidden="true"></span>
            <button type="button" class="ribbon-btn" data-cmd="justifyLeft" title="Aligner à gauche">${ribIcon('alignLeft')}</button>
            <button type="button" class="ribbon-btn" data-cmd="justifyCenter" title="Centrer">${ribIcon('alignCenter')}</button>
            <button type="button" class="ribbon-btn" data-cmd="justifyRight" title="Aligner à droite">${ribIcon('alignRight')}</button>
            <button type="button" class="ribbon-btn" data-cmd="justifyFull" title="Justifier">${ribIcon('alignJustify')}</button>
          </div>
          <span class="ribbon-group__label">Paragraphe</span>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-row">
            ${ribbonBtn('link', 'Lien', 'Insérer un lien', 'id="ed-insert-link"')}
            ${ribbonBtn('table', 'Tableau', 'Insérer un tableau', 'id="ed-insert-table"')}
            ${ribbonBtn('rule', 'Règle', 'Insérer une ligne horizontale', 'id="ed-insert-rule"')}
            ${ribbonBtn('math', 'Math', 'Insérer une formule KaTeX', 'id="ed-insert-math"')}
          </div>
          <span class="ribbon-group__label">Insérer</span>
        </div>

        <div class="ribbon-group">
          <div class="ribbon-row">
            <button type="button" class="ribbon-btn" data-cmd="removeFormat" title="Effacer la mise en forme">${ribIcon('clear')}<span>Effacer</span></button>
            <button type="button" class="ribbon-btn ribbon-btn--toggle" id="ed-preview" title="Aperçu (mode lecture)">${ribIcon('eye')}<span>Aperçu</span></button>
          </div>
          <span class="ribbon-group__label">Édition</span>
        </div>
      </div>

      <div class="word-editor__canvas" id="ed-canvas">
        <div class="word-editor__page">
          <div class="word-editor__dochead">
            <input class="word-editor__title" id="ed-title" placeholder="Titre du document" autocomplete="off" aria-label="Titre">
            <div class="word-editor__metaline">
              <input class="word-editor__meta" id="ed-subject" placeholder="Matière (ex : Physique)" autocomplete="off" aria-label="Matière">
              <span class="word-editor__dot" aria-hidden="true">•</span>
              <input class="word-editor__meta" id="ed-topic" placeholder="Chapitre (ex : Thermodynamique)" autocomplete="off" aria-label="Chapitre">
            </div>
          </div>

          <div class="word-editor__content markdown-body" id="ed-content"
               contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"
               aria-label="Contenu de la fiche"
               data-placeholder="Commencez à écrire votre fiche…"></div>
        </div>
      </div>

      <div class="word-editor__statusbar">
        <span id="ed-counter">0 mot</span>
        <span id="ed-status">Prêt</span>
      </div>
    </div>
  `;

  bindListeners();
  bindRibbon();

  // Enter creates <p> blocks (rather than <div>), which converts cleanly.
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* noop */ }

  if (state.noteId) {
    await loadNote(state.noteId);
  } else if (params.importedContent) {
    container.querySelector('#ed-title').value = params.importedTitle || '';
    setEditorMarkdown(params.importedContent);
    state.dirty = true;
    setStatus('Importé — non enregistré');
    updateFilename();
  } else {
    setEditorMarkdown('');
    setStatus('Prêt');
  }
}

async function loadNote(noteId) {
  try {
    const note = await FirestoreService.getNote(noteId);
    if (!note) { showToast('Fiche introuvable.', 'error'); return; }

    const c = state.container;
    c.querySelector('#ed-title').value = note.title || '';
    c.querySelector('#ed-subject').value = note.subject || '';
    c.querySelector('#ed-topic').value = note.topic || '';
    c.querySelector('#ed-public').checked = Boolean(note.isPublic);
    setEditorMarkdown(note.content || '');
    updateFilename();

    state.initialChars = note.charCount ?? (note.content || '').length;
    state.initialPublic = Boolean(note.isPublic);
    state.noteOwner = note.uid || null;
    state.dirty = false;

    // Shared or public fiches are readable but not writable by anyone except
    // their owner (and admins) — switch the whole editor to read-only.
    const canEdit = !AppState.user
      || note.uid === AppState.user.uid
      || AppState.isAdmin === true;
    if (!canEdit) applyReadOnly();

    if (AppState.user?.uid) {
      FirestoreService.logAccess({ uid: AppState.user.uid, documentId: noteId, documentType: 'note', action: 'view' });
    }
  } catch (err) {
    console.error('[Editor] load failed:', err);
    showToast(`Chargement impossible : ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Editor state helpers
// ---------------------------------------------------------------------------

function getContentEl() { return state.container?.querySelector('#ed-content'); }

/** Render stored Markdown into the page (no KaTeX — it would not round-trip). */
function renderMarkdownIntoPage(markdown) {
  const content = getContentEl();
  if (!content) return;
  content.innerHTML = ConverterService.renderMarkdown(markdown || '');
}

function setEditorMarkdown(markdown) {
  renderMarkdownIntoPage(markdown);
  state.dirty = false;
  updateCounter();
  setStatus('Enregistré');
}

/** Page HTML → stored Markdown. */
function pageToMarkdown() {
  const content = getContentEl();
  return content ? ConverterService.editorHtmlToMarkdown(content.innerHTML) : '';
}

function setStatus(text) {
  const el = state.container?.querySelector('#ed-status');
  if (el) el.textContent = text;
}

function updateFilename() {
  const c = state.container;
  const label = c?.querySelector('#ed-filename');
  if (!label) return;
  const title = c.querySelector('#ed-title')?.value.trim();
  label.textContent = title || 'Sans titre';
}

function plainText() {
  return (getContentEl()?.innerText || '').replace(/\u00a0/g, ' ');
}

function updateCounter() {
  const counter = state.container?.querySelector('#ed-counter');
  if (!counter) return;
  const text = plainText().trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.replace(/\s+/g, ' ').length;
  counter.textContent = `${words.toLocaleString('fr-FR')} mot${words === 1 ? '' : 's'} · ${chars.toLocaleString('fr-FR')} caractère${chars === 1 ? '' : 's'}`;
}

/** Called after every edit / command. */
function onEdit() {
  if (state.readOnly || state.preview) return;
  state.dirty = true;
  setStatus('Modifications non enregistrées');
  updateCounter();
  updateToolbarState();
}

// ---------------------------------------------------------------------------
// Selection + ribbon commands
// ---------------------------------------------------------------------------

function saveSelection() {
  const content = getContentEl();
  const sel = window.getSelection();
  if (!content || !sel || !sel.rangeCount) return;
  const node = sel.anchorNode;
  if (node && content.contains(node)) {
    state.savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  const content = getContentEl();
  if (!content || state.readOnly) return;
  if (state.savedRange) {
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(state.savedRange);
    } catch {
      state.savedRange = null;
    }
  }
  content.focus();
}

function runCommand(cmd, value) {
  if (state.readOnly || state.preview) return;
  restoreSelection();
  const arg = cmd === 'formatBlock' && value && !value.startsWith('<') ? `<${value}>` : (value || null);
  try {
    document.execCommand(cmd, false, arg);
  } catch (err) {
    console.warn('[Editor] command failed:', cmd, err);
  }
  onEdit();
  updateToolbarState();
}

const TOGGLE_COMMANDS = [
  'bold', 'italic', 'underline', 'strikeThrough',
  'insertUnorderedList', 'insertOrderedList',
  'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'
];

/** Reflect the caret's formatting in the ribbon. */
function updateToolbarState() {
  const c = state.container;
  const content = getContentEl();
  if (!c || !content || state.readOnly || state.preview) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !content.contains(sel.anchorNode)) return;

  TOGGLE_COMMANDS.forEach(cmd => {
    const btn = c.querySelector(`[data-cmd="${cmd}"]`);
    if (!btn) return;
    let active = false;
    try { active = document.queryCommandState(cmd); } catch { /* noop */ }
    btn.classList.toggle('is-active', Boolean(active));
  });

  const block = c.querySelector('#ed-block');
  if (block) {
    let value = '';
    try { value = String(document.queryCommandValue('formatBlock') || ''); } catch { /* noop */ }
    value = value.replace(/[<>]/g, '').toLowerCase();
    const map = { '': 'p', div: 'p', p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', blockquote: 'blockquote', pre: 'pre' };
    block.value = map[value] || 'p';
  }
}

function setRibbonDisabled(disabled) {
  const c = state.container;
  c?.querySelectorAll('#ed-ribbon button, #ed-ribbon select').forEach(el => {
    if (el.id === 'ed-preview') return;
    el.disabled = disabled;
  });
  c?.querySelector('#ed-ribbon')?.classList.toggle('word-editor__ribbon--disabled', disabled);
}

// ---------------------------------------------------------------------------
// Insertions (link, table, rule, math)
// ---------------------------------------------------------------------------

function insertLink() {
  if (state.readOnly || state.preview) return;

  const selected = window.getSelection()?.toString().trim() || '';
  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Insérer un lien</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="ed-link-url">Adresse (URL)</label>
        <input class="input" type="url" id="ed-link-url" placeholder="https://…" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="ed-link-text">Texte affiché</label>
        <input class="input" type="text" id="ed-link-text" placeholder="Facultatif" value="${escapeAttr(selected)}">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Insérer</button>
      </div>
    </form>`;

  const { hide } = showModal(wrap);
  const urlInput = wrap.querySelector('#ed-link-url');
  const textInput = wrap.querySelector('#ed-link-text');

  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);
  wrap.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    let url = urlInput.value.trim();
    if (!url) { showToast('Veuillez saisir une URL.', 'error'); urlInput.focus(); return; }
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(url)) url = `https://${url}`;

    const text = textInput.value.trim() || url;
    hide();
    restoreSelection();
    document.execCommand('insertHTML', false, `<a href="${escapeAttr(url)}">${escapeHtml(text)}</a>`);
    onEdit();
  });

  setTimeout(() => urlInput.focus(), 40);
}

function insertTable() {
  if (state.readOnly || state.preview) return;
  restoreSelection();
  const table = '<table><thead><tr><th>Colonne 1</th><th>Colonne 2</th></tr></thead><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>';
  document.execCommand('insertHTML', false, table);
  onEdit();
}

function insertRule() {
  if (state.readOnly || state.preview) return;
  restoreSelection();
  document.execCommand('insertHorizontalRule');
  onEdit();
}

function insertMath() {
  if (state.readOnly || state.preview) return;

  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <h3 class="dialog__title">Insérer une formule</h3>
    <form class="dialog__form" novalidate>
      <div class="form-group">
        <label class="form-label" for="ed-math-input">Formule LaTeX</label>
        <textarea class="textarea" id="ed-math-input" rows="3" placeholder="E = mc^2"></textarea>
        <p class="form-hint form-hint--left">Affichée dans l’aperçu. Les délimiteurs <code>$…$</code> sont ajoutés automatiquement.</p>
      </div>
      <label class="form-check">
        <input type="checkbox" id="ed-math-block">
        <span>Formule centrée (bloc)</span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" data-action="cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Insérer</button>
      </div>
    </form>`;

  const { hide } = showModal(wrap);
  const input = wrap.querySelector('#ed-math-input');

  wrap.querySelector('[data-action="cancel"]').addEventListener('click', hide);
  wrap.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const latex = input.value.trim();
    if (!latex) { showToast('Veuillez saisir une formule.', 'error'); input.focus(); return; }
    const block = wrap.querySelector('#ed-math-block').checked;
    hide();
    restoreSelection();
    document.execCommand('insertText', false, block ? `$$${latex}$$` : `$${latex}$`);
    onEdit();
  });

  setTimeout(() => input.focus(), 40);
}

// ---------------------------------------------------------------------------
// Preview (reading view with KaTeX)
// ---------------------------------------------------------------------------

function togglePreview() {
  const c = state.container;
  const content = getContentEl();
  const btn = c?.querySelector('#ed-preview');
  if (!content || !btn) return;

  if (!state.preview) {
    // Also runs for read-only fiches: the page still holds the rendered HTML.
    state.previewMarkdown = pageToMarkdown();
  }

  state.preview = !state.preview;
  state.savedRange = null;
  btn.classList.toggle('is-active', state.preview);

  if (state.preview) {
    content.contentEditable = 'false';
    content.innerHTML = ConverterService.renderMarkdown(state.previewMarkdown);
    ConverterService.renderMathInElement(content);
    setRibbonDisabled(true);
    btn.innerHTML = state.readOnly
      ? `${ribIcon('eye')}<span>Retour</span>`
      : `${ribIcon('pencil')}<span>Modifier</span>`;
    setStatus('Aperçu');
    updateCounter();
    return;
  }

  content.contentEditable = state.readOnly ? 'false' : 'true';
  renderMarkdownIntoPage(state.previewMarkdown);
  setRibbonDisabled(state.readOnly);
  btn.innerHTML = `${ribIcon('eye')}<span>Aperçu</span>`;
  setStatus(state.readOnly ? 'Lecture seule' : (state.dirty ? 'Modifications non enregistrées' : 'Enregistré'));
  updateCounter();
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

function bindListeners() {
  const c = state.container;
  const content = getContentEl();

  content.addEventListener('input', () => {
    state.dirty = !state.readOnly;
    setStatus(state.readOnly ? 'Lecture seule' : 'Modifications non enregistrées');
    updateCounter();
    if (state.readOnly) return;
    updateToolbarState();
  });

  content.addEventListener('mouseup', saveSelection);
  content.addEventListener('keyup', saveSelection);
  content.addEventListener('focus', saveSelection);
  content.addEventListener('paste', () => setTimeout(saveSelection, 0));

  // Never let a click inside the document navigate the SPA away (and lose
  // unsaved work). Reading mode opens the link in a new tab instead.
  content.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    e.preventDefault();
    if (state.preview || state.readOnly) window.open(link.href, '_blank', 'noopener');
  });

  c.querySelector('#ed-title').addEventListener('input', () => {
    if (!state.readOnly) {
      state.dirty = true;
      setStatus('Modifications non enregistrées');
    }
    updateFilename();
  });
  ['#ed-subject', '#ed-topic'].forEach(sel => {
    c.querySelector(sel).addEventListener('input', () => {
      if (!state.readOnly) {
        state.dirty = true;
        setStatus('Modifications non enregistrées');
      }
    });
  });

  c.querySelector('#ed-save').addEventListener('click', save);
  c.querySelector('#ed-cancel').addEventListener('click', close);
  c.querySelector('#ed-delete')?.addEventListener('click', remove);

  const onSelChange = () => {
    saveSelection();
    updateToolbarState();
  };
  document.addEventListener('selectionchange', onSelChange);
  state.cleanup.push(() => document.removeEventListener('selectionchange', onSelChange));

  // Ctrl/Cmd+S saves.
  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup.push(() => document.removeEventListener('keydown', onKey));
}

function bindRibbon() {
  const c = state.container;

  c.querySelectorAll('#ed-ribbon [data-cmd]').forEach(btn => {
    // Keep the caret where it is when the button steals the click.
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => runCommand(btn.dataset.cmd, btn.dataset.value));
  });

  const block = c.querySelector('#ed-block');
  block?.addEventListener('change', () => {
    if (state.readOnly || state.preview) return;
    restoreSelection();
    try { document.execCommand('formatBlock', false, `<${block.value || 'p'}>`); } catch { /* noop */ }
    onEdit();
  });

  // Insert buttons keep the selection too; dialogs open afterwards.
  ['#ed-insert-link', '#ed-insert-table', '#ed-insert-rule', '#ed-insert-math'].forEach(sel => {
    c.querySelector(sel)?.addEventListener('mousedown', e => e.preventDefault());
  });
  c.querySelector('#ed-insert-link')?.addEventListener('click', insertLink);
  c.querySelector('#ed-insert-table')?.addEventListener('click', insertTable);
  c.querySelector('#ed-insert-rule')?.addEventListener('click', insertRule);
  c.querySelector('#ed-insert-math')?.addEventListener('click', insertMath);
  c.querySelector('#ed-preview')?.addEventListener('click', togglePreview);
}

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

/** Lock the editor: this fiche belongs to someone else. */
function applyReadOnly() {
  const c = state.container;
  if (!c || state.readOnly) return;
  state.readOnly = true;
  state.preview = false;
  c.classList.add('editor--readonly');

  const content = getContentEl();
  if (content) content.contentEditable = 'false';

  ['#ed-title', '#ed-subject', '#ed-topic'].forEach(sel => {
    const el = c.querySelector(sel);
    if (el) el.readOnly = true;
  });
  const pub = c.querySelector('#ed-public');
  if (pub) pub.disabled = true;

  c.querySelector('#ed-save')?.remove();
  c.querySelector('#ed-delete')?.remove();
  const cancel = c.querySelector('#ed-cancel');
  if (cancel) cancel.textContent = 'Fermer';

  const badge = c.querySelector('#ed-badge');
  if (badge) badge.hidden = false;

  setRibbonDisabled(true);
  setStatus('Lecture seule');
}

// ---------------------------------------------------------------------------
// Save / delete / close
// ---------------------------------------------------------------------------

async function save() {
  if (state.readOnly || state.saving) return;

  const c = state.container;
  const title = c.querySelector('#ed-title').value.trim();
  const subject = c.querySelector('#ed-subject').value.trim() || 'Général';
  const topic = c.querySelector('#ed-topic').value.trim();
  const isPublic = Boolean(c.querySelector('#ed-public')?.checked);
  const content = state.preview ? state.previewMarkdown : pageToMarkdown();

  if (!title) {
    showToast('Veuillez saisir un titre.', 'error');
    c.querySelector('#ed-title').focus();
    return;
  }

  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour enregistrer.', 'error'); return; }
  // An admin may be editing someone else's public fiche: the quota belongs to
  // the note's owner, not to the admin pressing the button.
  const owner = state.noteOwner || uid;

  const newChars = ConverterService.getCharCount(content);

  try {
    let additional = newChars;
    if (state.noteId) additional = Math.max(0, newChars - state.initialChars);
    if (additional > 0) {
      const q = await QuotaManager.checkQuota(owner, additional);
      if (!q.allowed) {
        showToast(`Quota dépassé : ${additional.toLocaleString('fr-FR')} car. nécessaires, ${q.remaining.toLocaleString('fr-FR')} restants.`, 'error');
        return;
      }
    }
  } catch (err) {
    console.warn('[Editor] quota check skipped:', err);
  }

  state.saving = true;
  const saveBtn = c.querySelector('#ed-save');
  const saveLabel = c.querySelector('#ed-save-label');
  saveBtn.disabled = true;
  if (saveLabel) saveLabel.textContent = 'Enregistrement…';

  try {
    let id = state.noteId;
    if (state.noteId) {
      await FirestoreService.updateNote(state.noteId, { title, content, subject, topic, isPublic });
      FirestoreService.logAccess({ uid, documentId: state.noteId, documentType: 'note', action: 'edit' });
    } else {
      id = await FirestoreService.createNote({ uid, title, content, subject, topic, isPublic, parentId: state.parentId });
      state.noteId = id;
      FirestoreService.logAccess({ uid, documentId: id, documentType: 'note', action: 'create' });
      ensureDeleteButton();
    }

    state.initialChars = newChars;
    if (state.preview) state.previewMarkdown = content;

    // Publishing/unpublishing reshuffles the public folder branches. An empty
    // owner name is fine — `syncShares` keeps the stored one.
    if (state.initialPublic !== isPublic) {
      await FirestoreService.syncTreeFlags(owner, '');
      state.initialPublic = isPublic;
    }
    state.dirty = false;

    updateFilename();
    setStatus('Enregistré');
    QuotaManager.recalculateQuota(owner).then(q => EventBus.emit('quota:updated', q)).catch(() => {});
    EventBus.emit('note:saved', { noteId: id });
    showToast('Fiche enregistrée.', 'success');
  } catch (err) {
    console.error('[Editor] save failed:', err);
    showToast(`Enregistrement échoué : ${err.message}`, 'error');
  } finally {
    state.saving = false;
    saveBtn.disabled = false;
    if (saveLabel) saveLabel.textContent = 'Enregistrer';
  }
}

function ensureDeleteButton() {
  const c = state.container;
  if (state.readOnly || c.querySelector('#ed-delete')) return;
  const actions = c.querySelector('.editor__actions');
  const saveBtn = c.querySelector('#ed-save');
  const btn = document.createElement('button');
  btn.className = 'btn btn--danger';
  btn.id = 'ed-delete';
  btn.innerHTML = `${iconImg('delete', { size: 16, alt: '' })}<span>Supprimer</span>`;
  btn.addEventListener('click', remove);
  actions.insertBefore(btn, saveBtn);
}

async function remove() {
  if (!state.noteId) return;
  const title = state.container?.querySelector('#ed-title').value.trim() || 'cette fiche';
  if (!confirm(`Supprimer définitivement « ${title} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    const owner = state.noteOwner || uid;
    await FirestoreService.deleteNote(state.noteId);
    if (uid) {
      FirestoreService.logAccess({ uid, documentId: state.noteId, documentType: 'note', action: 'delete' });
    }
    if (owner) {
      QuotaManager.recalculateQuota(owner).then(q => EventBus.emit('quota:updated', q)).catch(() => {});
    }
    // Keep the public branches and the inherited grants in sync.
    await FirestoreService.syncTreeFlags(owner, '');
    EventBus.emit('note:deleted', { noteId: state.noteId });
    showToast('Fiche supprimée.', 'success');
    close(true);
  } catch (err) {
    console.error('[Editor] delete failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

function close(force = false) {
  if (!force && state.dirty && !confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return;
  const panelId = state.panelId || state.container?.closest('.workspace__panel')?.dataset.panelId;
  EventBus.emit('panel:close', { panelId });
}

/** Tear down. */
export function destroy() {
  state.cleanup.forEach(fn => { try { fn(); } catch { /* noop */ } });
  state.cleanup = [];
  state.container = null;
  state.panelId = null;
  state.noteId = null;
  state.parentId = null;
  state.dirty = false;
  state.readOnly = false;
  state.preview = false;
  state.previewMarkdown = '';
  state.savedRange = null;
  state.noteOwner = null;
  state.initialChars = 0;
  state.initialPublic = false;
  state.saving = false;
}
