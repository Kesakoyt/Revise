/**
 * Fiches & Cloud — Markdown editor.
 *
 * Split pane: Markdown source (left) and live HTML + KaTeX preview (right).
 * Handles quota validation, save / delete and unsaved-change guards.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast, iconImg } from '../app.js';

const state = {
  container: null,
  panelId: null,
  noteId: null,
  parentId: null,
  initialContent: '',
  initialTitle: '',
  initialChars: 0,
  saving: false,
  dirty: false,
  previewTimer: null,
  cleanup: []
};

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

  container.classList.add('editor-panel-container');

  container.innerHTML = `
    <div class="editor">
      <div class="editor__toolbar">
        <div class="editor__meta">
          <input type="text" class="input editor__title" id="ed-title" placeholder="Titre de la fiche (requis)…" autocomplete="off">
          <input type="text" class="input editor__subject" id="ed-subject" placeholder="Matière (ex : Physique)" autocomplete="off">
          <input type="text" class="input editor__topic" id="ed-topic" placeholder="Chapitre (ex : Thermodynamique)" autocomplete="off">
          <label class="toggle" title="Rendre la fiche visible par tous">
            <input type="checkbox" class="toggle__input" id="ed-public">
            <span class="toggle__slider"></span>
            <span class="toggle__label">Publique</span>
          </label>
        </div>

        <div class="editor__actions">
          <span class="editor__counter" id="ed-counter">0 car.</span>
          <button type="button" class="btn btn--secondary" id="ed-cancel">Annuler</button>
          ${state.noteId ? `<button type="button" class="btn btn--danger" id="ed-delete">${iconImg('delete', { size: 16, alt: '' })}<span>Supprimer</span></button>` : ''}
          <button type="button" class="btn btn--primary" id="ed-save">${iconImg('save', { size: 16, alt: '' })}<span id="ed-save-label">Enregistrer</span></button>
        </div>
      </div>

      <div class="editor__split">
        <div class="editor__pane editor__pane--input">
          <div class="editor__pane-head">
            <span>Markdown</span>
            <span class="editor__hint">Markdown &amp; KaTeX ($…$, $$…$$)</span>
          </div>
          <textarea class="textarea editor__textarea" id="ed-content" spellcheck="false"
            placeholder="Écrivez votre fiche en Markdown…&#10;&#10;## Exemples&#10;- Math : $E = mc^2$&#10;- Bloc :&#10;$$ \\int_0^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} $$"></textarea>
        </div>

        <div class="editor__divider" id="ed-divider" role="separator" aria-orientation="vertical" tabindex="0"></div>

        <div class="editor__pane editor__pane--preview">
          <div class="editor__pane-head">
            <span>Aperçu</span>
            <span class="editor__status" id="ed-status">Synchronisé</span>
          </div>
          <div class="editor__preview markdown-body" id="ed-preview"></div>
        </div>
      </div>
    </div>
  `;

  bindListeners();

  if (state.noteId) {
    await loadNote(state.noteId);
  } else if (params.importedContent) {
    container.querySelector('#ed-content').value = params.importedContent;
    if (params.importedTitle) container.querySelector('#ed-title').value = params.importedTitle;
    state.dirty = true;
    updatePreview();
    updateCounter();
  } else {
    updatePreview();
    updateCounter();
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
    c.querySelector('#ed-content').value = note.content || '';

    state.initialContent = note.content || '';
    state.initialTitle = note.title || '';
    state.initialChars = note.charCount ?? (note.content || '').length;
    state.dirty = false;

    updatePreview();
    updateCounter();

    if (AppState.user?.uid) {
      FirestoreService.logAccess({ uid: AppState.user.uid, documentId: noteId, documentType: 'note', action: 'view' });
    }
  } catch (err) {
    console.error('[Editor] load failed:', err);
    showToast(`Chargement impossible : ${err.message}`, 'error');
  }
}

function bindListeners() {
  const c = state.container;
  const content = c.querySelector('#ed-content');

  content.addEventListener('input', () => {
    state.dirty = true;
    updateCounter();
    schedulePreview();
  });

  // Tab inserts two spaces instead of moving focus.
  content.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en, value } = content;
    content.value = value.slice(0, s) + '  ' + value.slice(en);
    content.selectionStart = content.selectionEnd = s + 2;
    state.dirty = true;
    schedulePreview();
  });

  c.querySelector('#ed-title').addEventListener('input', () => { state.dirty = true; });
  c.querySelector('#ed-save').addEventListener('click', save);
  c.querySelector('#ed-cancel').addEventListener('click', close);
  c.querySelector('#ed-delete')?.addEventListener('click', remove);

  // Ctrl/Cmd+S saves.
  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup.push(() => document.removeEventListener('keydown', onKey));

  setupDivider();
}

function setupDivider() {
  const c = state.container;
  const divider = c.querySelector('#ed-divider');
  const split = c.querySelector('.editor__split');
  const left = c.querySelector('.editor__pane--input');
  let dragging = false;

  const onMove = e => {
    if (!dragging) return;
    const rect = split.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    if (pct > 20 && pct < 80) left.style.flex = `0 0 ${pct}%`;
  };
  const onUp = () => {
    dragging = false;
    document.body.classList.remove('is-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  const onDown = () => {
    dragging = true;
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  divider.addEventListener('mousedown', onDown);
  state.cleanup.push(() => {
    divider.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  });
}

function schedulePreview() {
  clearTimeout(state.previewTimer);
  const status = state.container?.querySelector('#ed-status');
  if (status) status.textContent = 'Mise à jour…';
  state.previewTimer = setTimeout(updatePreview, 300);
}

function updatePreview() {
  const c = state.container;
  const content = c?.querySelector('#ed-content');
  const preview = c?.querySelector('#ed-preview');
  const status = c?.querySelector('#ed-status');
  if (!content || !preview) return;

  preview.innerHTML = ConverterService.renderMarkdown(content.value || '');
  ConverterService.renderMathInElement(preview);
  if (status) status.textContent = 'Synchronisé';
}

function updateCounter() {
  const c = state.container;
  const content = c?.querySelector('#ed-content');
  const counter = c?.querySelector('#ed-counter');
  if (!content || !counter) return;
  counter.textContent = `${ConverterService.getCharCount(content.value).toLocaleString('fr-FR')} car.`;
}

async function save() {
  if (state.saving) return;

  const c = state.container;
  const title = c.querySelector('#ed-title').value.trim();
  const subject = c.querySelector('#ed-subject').value.trim() || 'Général';
  const topic = c.querySelector('#ed-topic').value.trim();
  const isPublic = c.querySelector('#ed-public').checked;
  const content = c.querySelector('#ed-content').value;

  if (!title) {
    showToast('Veuillez saisir un titre.', 'error');
    c.querySelector('#ed-title').focus();
    return;
  }

  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour enregistrer.', 'error'); return; }

  const newChars = ConverterService.getCharCount(content);

  try {
    let additional = newChars;
    if (state.noteId) additional = Math.max(0, newChars - state.initialChars);
    if (additional > 0) {
      const q = await QuotaManager.checkQuota(uid, additional);
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

    state.initialContent = content;
    state.initialTitle = title;
    state.initialChars = newChars;
    state.dirty = false;

    QuotaManager.recalculateQuota(uid).then(q => EventBus.emit('quota:updated', q)).catch(() => {});
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
  if (c.querySelector('#ed-delete')) return;
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
    await FirestoreService.deleteNote(state.noteId);
    if (uid) {
      FirestoreService.logAccess({ uid, documentId: state.noteId, documentType: 'note', action: 'delete' });
      QuotaManager.recalculateQuota(uid).then(q => EventBus.emit('quota:updated', q)).catch(() => {});
    }
    EventBus.emit('note:deleted', { noteId: state.noteId });
    showToast('Fiche supprimée.', 'success');
    close();
  } catch (err) {
    console.error('[Editor] delete failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

function close() {
  if (state.dirty && !confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return;
  const panelId = state.panelId || state.container?.closest('.workspace__panel')?.dataset.panelId;
  EventBus.emit('panel:close', { panelId });
}

/** Tear down. */
export function destroy() {
  clearTimeout(state.previewTimer);
  state.cleanup.forEach(fn => { try { fn(); } catch { /* noop */ } });
  state.cleanup = [];
  state.container = null;
  state.panelId = null;
  state.noteId = null;
  state.parentId = null;
  state.dirty = false;
}
