/**
 * Markdown Editor Component
 * Split-view editor with live KaTeX math preview, quota validation, save/delete operations.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast } from '../app.js';

// Internal module state
const state = {
  container: null,
  panelId: null,
  noteId: null,
  initialContent: '',
  initialTitle: '',
  initialCharCount: 0,
  isSaving: false,
  debounceTimer: null,
  hasUnsavedChanges: false
};

/**
 * Renders Markdown Editor inside given container
 * @param {HTMLElement} container 
 * @param {Object} params - { noteId, importedContent, importedTitle, panelId }
 */
export async function render(container, params = {}) {
  state.container = container;
  state.panelId = params.panelId || container.dataset?.panelId || container.closest('.workspace__panel')?.dataset?.panelId;
  state.noteId = params.noteId || null;
  state.hasUnsavedChanges = false;

  container.classList.add('editor-panel-container');

  // Build skeleton UI
  container.innerHTML = `
    <div class="editor">
      <!-- Toolbar -->
      <div class="editor__toolbar">
        <div class="editor__meta-inputs">
          <input 
            type="text" 
            class="input editor__input-title" 
            id="editor-title" 
            placeholder="Note title (required)..." 
            value="" 
            autocomplete="off"
          />
          <input 
            type="text" 
            class="input editor__input-subject" 
            id="editor-subject" 
            placeholder="Subject (e.g. Physics)" 
            value="" 
            autocomplete="off"
          />
          <input 
            type="text" 
            class="input editor__input-topic" 
            id="editor-topic" 
            placeholder="Topic (e.g. Thermodynamics)" 
            value="" 
            autocomplete="off"
          />
          <label class="editor__public-toggle" title="Make note publicly viewable by others">
            <input type="checkbox" id="editor-is-public" />
            <span class="toggle-slider"></span>
            <span class="toggle-label">Public</span>
          </label>
        </div>

        <div class="editor__actions">
          <div class="editor__char-counter" id="editor-char-counter">
            0 chars
          </div>
          <button class="btn btn--secondary" id="editor-close-btn" title="Close editor panel">
            Cancel
          </button>
          ${state.noteId ? `
            <button class="btn btn--danger" id="editor-delete-btn" title="Delete this note">
              <img src="https://img.icons8.com/fluency/16/delete.png" alt="" />
              <span>Delete</span>
            </button>
          ` : ''}
          <button class="btn btn--primary" id="editor-save-btn">
            <img src="https://img.icons8.com/fluency/16/save.png" alt="" />
            <span id="editor-save-label">Save</span>
          </button>
        </div>
      </div>

      <!-- Split View -->
      <div class="editor__split">
        <!-- Editor Left Half -->
        <div class="editor__pane editor__pane--input">
          <div class="editor__pane-header">
            <span>Markdown Source</span>
            <span class="editor__hint">Supports Markdown & KaTeX ($...$, $$...$$)</span>
          </div>
          <textarea 
            class="textarea editor__textarea" 
            id="editor-textarea" 
            placeholder="Write your note in Markdown here...&#10;&#10;## Examples:&#10;- Math: $E = mc^2$&#10;- Block Math:&#10;$$ \int_{0}^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2} $$"
            spellcheck="false"
          ></textarea>
        </div>

        <!-- Resizer Divider -->
        <div class="editor__divider" id="editor-split-divider"></div>

        <!-- Preview Right Half -->
        <div class="editor__pane editor__pane--preview">
          <div class="editor__pane-header">
            <span>Live Preview</span>
            <span class="editor__status-badge" id="editor-preview-status">Synced</span>
          </div>
          <div class="editor__preview markdown-body" id="editor-preview-content"></div>
        </div>
      </div>
    </div>
  `;

  // Attach DOM Listeners
  setupEditorListeners();

  // Load existing note data or imported content
  if (state.noteId) {
    await loadNote(state.noteId);
  } else if (params.importedContent) {
    const textarea = container.querySelector('#editor-textarea');
    const titleInput = container.querySelector('#editor-title');
    if (textarea) textarea.value = params.importedContent;
    if (titleInput && params.importedTitle) titleInput.value = params.importedTitle;
    state.hasUnsavedChanges = true;
    updatePreview();
    updateCharCounter();
  } else {
    updatePreview();
    updateCharCounter();
  }
}

/**
 * Loads note data from Firestore
 * @param {string} noteId 
 */
async function loadNote(noteId) {
  const container = state.container;
  if (!container) return;

  try {
    showToast('Loading note...', 'info');
    const note = await FirestoreService.getNote(noteId);

    if (!note) {
      showToast('Note not found', 'error');
      return;
    }

    const titleInput = container.querySelector('#editor-title');
    const subjectInput = container.querySelector('#editor-subject');
    const topicInput = container.querySelector('#editor-topic');
    const publicCheckbox = container.querySelector('#editor-is-public');
    const textarea = container.querySelector('#editor-textarea');

    if (titleInput) titleInput.value = note.title || '';
    if (subjectInput) subjectInput.value = note.subject || '';
    if (topicInput) topicInput.value = note.topic || '';
    if (publicCheckbox) publicCheckbox.checked = !!note.isPublic;
    if (textarea) textarea.value = note.content || '';

    state.initialContent = note.content || '';
    state.initialTitle = note.title || '';
    state.initialCharCount = note.charCount || note.content?.length || 0;
    state.hasUnsavedChanges = false;

    updatePreview();
    updateCharCounter();

    // Log access
    if (AppState.user?.uid) {
      FirestoreService.logAccess({
        uid: AppState.user.uid,
        documentId: noteId,
        documentType: 'note',
        action: 'view'
      }).catch(console.error);
    }
  } catch (err) {
    console.error('Failed to load note:', err);
    showToast(`Failed to load note: ${err.message}`, 'error');
  }
}

/**
 * Sets up editor input and button listeners
 */
function setupEditorListeners() {
  const container = state.container;
  if (!container) return;

  const textarea = container.querySelector('#editor-textarea');
  const titleInput = container.querySelector('#editor-title');
  const saveBtn = container.querySelector('#editor-save-btn');
  const deleteBtn = container.querySelector('#editor-delete-btn');
  const closeBtn = container.querySelector('#editor-close-btn');

  // Input debouncing for live preview
  textarea?.addEventListener('input', () => {
    state.hasUnsavedChanges = true;
    updateCharCounter();
    schedulePreviewUpdate();
  });

  // Tab key support in textarea
  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      state.hasUnsavedChanges = true;
      schedulePreviewUpdate();
    }
  });

  titleInput?.addEventListener('input', () => {
    state.hasUnsavedChanges = true;
  });

  // Save button
  saveBtn?.addEventListener('click', async () => {
    await handleSave();
  });

  // Delete button
  deleteBtn?.addEventListener('click', async () => {
    await handleDelete();
  });

  // Close button
  closeBtn?.addEventListener('click', () => {
    handleClose();
  });

  // Split Divider Dragging (resizing editor and preview panes)
  setupSplitResizer();
}

/**
 * Resizer logic for split view
 */
function setupSplitResizer() {
  const container = state.container;
  const divider = container?.querySelector('#editor-split-divider');
  const splitContainer = container?.querySelector('.editor__split');
  const leftPane = container?.querySelector('.editor__pane--input');
  
  if (!divider || !splitContainer || !leftPane) return;

  let isDragging = false;

  const onMouseDown = (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const rect = splitContainer.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const percentage = (offsetX / rect.width) * 100;
    if (percentage > 20 && percentage < 80) {
      leftPane.style.flex = `0 0 ${percentage}%`;
    }
  };

  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  };

  divider.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  state._dividerCleanup = () => {
    divider.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}

/**
 * Debounced live preview update (300ms)
 */
function schedulePreviewUpdate() {
  clearTimeout(state.debounceTimer);
  const statusBadge = state.container?.querySelector('#editor-preview-status');
  if (statusBadge) statusBadge.textContent = 'Updating...';

  state.debounceTimer = setTimeout(() => {
    updatePreview();
  }, 300);
}

/**
 * Render Markdown and KaTeX math in preview
 */
function updatePreview() {
  const container = state.container;
  const textarea = container?.querySelector('#editor-textarea');
  const preview = container?.querySelector('#editor-preview-content');
  const statusBadge = container?.querySelector('#editor-preview-status');

  if (!textarea || !preview) return;

  const rawMarkdown = textarea.value || '';
  
  // Convert Markdown to HTML
  const html = ConverterService.renderMarkdown(rawMarkdown);
  preview.innerHTML = html;

  // Render KaTeX Math Expressions
  try {
    ConverterService.renderMathInElement(preview);
  } catch (err) {
    console.warn('Math rendering warning:', err);
  }

  if (statusBadge) statusBadge.textContent = 'Synced';
}

/**
 * Updates character count badge in toolbar
 */
function updateCharCounter() {
  const container = state.container;
  const textarea = container?.querySelector('#editor-textarea');
  const counter = container?.querySelector('#editor-char-counter');
  if (!textarea || !counter) return;

  const count = ConverterService.getCharCount(textarea.value || '');
  counter.textContent = `${count.toLocaleString()} chars`;
}

/**
 * Handles note save logic including quota checks
 */
async function handleSave() {
  if (state.isSaving) return;

  const container = state.container;
  const titleInput = container?.querySelector('#editor-title');
  const subjectInput = container?.querySelector('#editor-subject');
  const topicInput = container?.querySelector('#editor-topic');
  const publicCheckbox = container?.querySelector('#editor-is-public');
  const textarea = container?.querySelector('#editor-textarea');
  const saveBtn = container?.querySelector('#editor-save-btn');
  const saveLabel = container?.querySelector('#editor-save-label');

  const title = titleInput?.value.trim() || '';
  const subject = subjectInput?.value.trim() || 'General';
  const topic = topicInput?.value.trim() || '';
  const isPublic = !!publicCheckbox?.checked;
  const content = textarea?.value || '';

  // 1. Validation
  if (!title) {
    showToast('Please provide a title for the note', 'error');
    titleInput?.focus();
    return;
  }

  const uid = AppState.user?.uid;
  if (!uid) {
    showToast('You must be signed in to save notes', 'error');
    return;
  }

  const newCharCount = ConverterService.getCharCount(content);

  // 2. Quota Check
  try {
    let additionalChars = newCharCount;
    if (state.noteId) {
      additionalChars = Math.max(0, newCharCount - state.initialCharCount);
    }

    if (additionalChars > 0) {
      const quotaCheck = await QuotaManager.checkQuota(uid, additionalChars);
      if (!quotaCheck.allowed) {
        showToast(`Quota exceeded! You need ${additionalChars.toLocaleString()} chars, but only ${quotaCheck.remaining.toLocaleString()} remaining.`, 'error');
        return;
      }
    }
  } catch (err) {
    console.warn('Quota check error (continuing save):', err);
  }

  // 3. Perform save
  state.isSaving = true;
  if (saveBtn) saveBtn.disabled = true;
  if (saveLabel) saveLabel.textContent = 'Saving...';

  try {
    let savedNoteId = state.noteId;

    if (state.noteId) {
      // Update existing
      await FirestoreService.updateNote(state.noteId, {
        title,
        content,
        subject,
        topic,
        isPublic,
        charCount: newCharCount
      });

      // Log access
      FirestoreService.logAccess({
        uid,
        documentId: state.noteId,
        documentType: 'note',
        action: 'edit'
      }).catch(console.error);
    } else {
      // Create new
      savedNoteId = await FirestoreService.createNote({
        uid,
        title,
        content,
        subject,
        topic,
        isPublic
      });

      state.noteId = savedNoteId;

      // Log access
      FirestoreService.logAccess({
        uid,
        documentId: savedNoteId,
        documentType: 'note',
        action: 'create'
      }).catch(console.error);

      // Add delete button if was newly created
      ensureDeleteButtonExists();
    }

    state.initialContent = content;
    state.initialTitle = title;
    state.initialCharCount = newCharCount;
    state.hasUnsavedChanges = false;

    // Recalculate Quota
    QuotaManager.recalculateQuota(uid).then(quota => {
      EventBus.emit('quota:updated', quota);
    }).catch(console.error);

    EventBus.emit('note:saved', { noteId: savedNoteId });
    showToast('Note saved successfully!', 'success');
  } catch (err) {
    console.error('Failed to save note:', err);
    showToast(`Save failed: ${err.message}`, 'error');
  } finally {
    state.isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    if (saveLabel) saveLabel.textContent = 'Save';
  }
}

/**
 * Ensures delete button is present in the toolbar after initial save
 */
function ensureDeleteButtonExists() {
  const container = state.container;
  const actions = container?.querySelector('.editor__actions');
  const saveBtn = container?.querySelector('#editor-save-btn');
  let deleteBtn = container?.querySelector('#editor-delete-btn');

  if (!deleteBtn && actions && saveBtn) {
    deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--danger';
    deleteBtn.id = 'editor-delete-btn';
    deleteBtn.title = 'Delete this note';
    deleteBtn.innerHTML = `
      <img src="https://img.icons8.com/fluency/16/delete.png" alt="" />
      <span>Delete</span>
    `;
    deleteBtn.addEventListener('click', handleDelete);
    actions.insertBefore(deleteBtn, saveBtn);
  }
}

/**
 * Handles note deletion
 */
async function handleDelete() {
  if (!state.noteId) return;

  const titleInput = state.container?.querySelector('#editor-title');
  const noteTitle = titleInput?.value.trim() || 'this note';

  if (!confirm(`Are you sure you want to permanently delete "${noteTitle}"?`)) {
    return;
  }

  try {
    showToast('Deleting note...', 'info');
    await FirestoreService.deleteNote(state.noteId);

    // Recalculate Quota
    if (AppState.user?.uid) {
      QuotaManager.recalculateQuota(AppState.user.uid).then(quota => {
        EventBus.emit('quota:updated', quota);
      }).catch(console.error);
    }

    EventBus.emit('note:deleted', { noteId: state.noteId });
    showToast('Note deleted', 'success');

    // Close panel
    closeCurrentPanel();
  } catch (err) {
    console.error('Failed to delete note:', err);
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

/**
 * Handles close action with unsaved confirmation
 */
function handleClose() {
  if (state.hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
  }
  closeCurrentPanel();
}

/**
 * Closes this panel via EventBus
 */
function closeCurrentPanel() {
  const panelId = state.panelId || state.container?.closest('.workspace__panel')?.dataset?.panelId;
  EventBus.emit('panel:close', { panelId });
}

/**
 * Cleanup function called on panel destruction
 */
export function destroy() {
  clearTimeout(state.debounceTimer);
  if (typeof state._dividerCleanup === 'function') {
    state._dividerCleanup();
  }
  state.container = null;
  state.panelId = null;
  state.noteId = null;
  state.hasUnsavedChanges = false;
}
