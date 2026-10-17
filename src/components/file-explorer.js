/**
 * File Explorer Component
 * Browse personal and public notes, filter/sort, drag-and-drop PDF/DOCX import, and quota tracking.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';
import { ConverterService } from '../services/converter-service.js';
import { EventBus, AppState, showToast } from '../app.js';

// Track active instance state
const state = {
  container: null,
  activeTab: 'my-notes', // 'my-notes' | 'public-notes'
  viewMode: 'list',       // 'list' | 'grid'
  subjectFilter: 'all',
  sortBy: 'date',         // 'date' | 'title' | 'subject'
  sortDir: 'desc',        // 'asc' | 'desc'
  searchQuery: '',
  notes: [],
  subjects: [],
  isLoading: false,
  quotaInfo: null,
  eventHandlers: []
};

/**
 * Renders the File Explorer component inside the container.
 * @param {HTMLElement} container 
 * @param {Object} params 
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('file-explorer-container');

  // Build skeleton layout
  container.innerHTML = `
    <div class="file-explorer">
      <!-- Header & Toolbar -->
      <div class="file-explorer__header">
        <div class="file-explorer__tabs">
          <button class="tab-btn ${state.activeTab === 'my-notes' ? 'tab-btn--active' : ''}" data-tab="my-notes">
            <img src="https://img.icons8.com/fluency/20/folder.png" alt="" class="tab-btn__icon" />
            My Notes
          </button>
          <button class="tab-btn ${state.activeTab === 'public-notes' ? 'tab-btn--active' : ''}" data-tab="public-notes">
            <img src="https://img.icons8.com/fluency/20/bookmark.png" alt="" class="tab-btn__icon" />
            Public Notes
          </button>
        </div>

        <div class="file-explorer__actions">
          <button class="btn btn--primary btn--new-note" id="fe-new-note-btn">
            <img src="https://img.icons8.com/fluency/18/add.png" alt="" />
            <span>New Note</span>
          </button>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="file-explorer__toolbar">
        <div class="file-explorer__search-wrapper">
          <img src="https://img.icons8.com/fluency/18/search.png" alt="" class="search-icon" />
          <input 
            type="text" 
            class="input input--search" 
            id="fe-search-input" 
            placeholder="Search notes by title, subject, or content..." 
            value="${escapeHtml(state.searchQuery)}"
          />
          ${state.searchQuery ? '<button class="btn-clear-search" id="fe-clear-search">&times;</button>' : ''}
        </div>

        <div class="file-explorer__filters">
          <div class="select-wrapper">
            <select class="input select" id="fe-subject-filter" aria-label="Filter by subject">
              <option value="all">All Subjects</option>
            </select>
          </div>

          <div class="select-wrapper">
            <select class="input select" id="fe-sort-select" aria-label="Sort notes">
              <option value="date-desc" ${state.sortBy === 'date' && state.sortDir === 'desc' ? 'selected' : ''}>Newest First</option>
              <option value="date-asc" ${state.sortBy === 'date' && state.sortDir === 'asc' ? 'selected' : ''}>Oldest First</option>
              <option value="title-asc" ${state.sortBy === 'title' && state.sortDir === 'asc' ? 'selected' : ''}>Title (A-Z)</option>
              <option value="title-desc" ${state.sortBy === 'title' && state.sortDir === 'desc' ? 'selected' : ''}>Title (Z-A)</option>
              <option value="subject-asc" ${state.sortBy === 'subject' && state.sortDir === 'asc' ? 'selected' : ''}>Subject (A-Z)</option>
            </select>
          </div>

          <div class="view-mode-toggle">
            <button class="btn btn--icon ${state.viewMode === 'list' ? 'btn--icon-active' : ''}" id="fe-view-list" title="List View">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
              </svg>
            </button>
            <button class="btn btn--icon ${state.viewMode === 'grid' ? 'btn--icon-active' : ''}" id="fe-view-grid" title="Grid View">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- File List Area -->
      <div class="file-explorer__body" id="fe-notes-body">
        <div class="file-explorer__loading">
          <div class="spinner"></div>
          <p>Loading notes...</p>
        </div>
      </div>

      <!-- Drag & Drop Zone -->
      <div class="drop-zone" id="fe-drop-zone">
        <input type="file" id="fe-file-input" accept=".pdf,.docx" style="display: none;" />
        <div class="drop-zone__content">
          <img src="https://img.icons8.com/fluency/32/import.png" alt="" class="drop-zone__icon" />
          <div class="drop-zone__text">
            <strong>Drop PDF or DOCX file here</strong> to convert to Markdown
            <span class="drop-zone__subtext">or <button type="button" class="btn-link" id="fe-browse-btn">browse files</button></span>
          </div>
        </div>
        <div class="drop-zone__overlay" id="fe-drop-overlay">
          <span>Drop file to import note</span>
        </div>
      </div>

      <!-- Quota Bar at Bottom -->
      <div class="file-explorer__quota" id="fe-quota-container">
        <div class="quota-bar">
          <div class="quota-bar__info">
            <span class="quota-bar__label">Storage Quota</span>
            <span class="quota-bar__text" id="fe-quota-text">Loading quota...</span>
          </div>
          <div class="quota-bar__track">
            <div class="quota-bar__fill" id="fe-quota-fill" style="width: 0%;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
  setupToolbarListeners();
  setupDropZone();
  setupBusListeners();

  // Load initial notes & quota
  await Promise.all([
    loadNotes(),
    updateQuotaDisplay()
  ]);
}

/**
 * Sets up toolbar and UI interaction listeners
 */
function setupToolbarListeners() {
  const container = state.container;
  if (!container) return;

  // Tab switching
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (state.activeTab === tab) return;
      state.activeTab = tab;
      
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
      e.currentTarget.classList.add('tab-btn--active');
      
      await loadNotes();
    });
  });

  // New Note Button
  const newNoteBtn = container.querySelector('#fe-new-note-btn');
  if (newNoteBtn) {
    newNoteBtn.addEventListener('click', () => {
      EventBus.emit('app:open', { appId: 'markdown-editor', params: {} });
    });
  }

  // Search input with debounce
  const searchInput = container.querySelector('#fe-search-input');
  let searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      state.searchQuery = e.target.value.trim().toLowerCase();
      searchTimeout = setTimeout(() => {
        renderNotesList();
      }, 250);
    });
  }

  // Clear search
  const clearBtn = container.querySelector('#fe-clear-search');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.searchQuery = '';
      if (searchInput) searchInput.value = '';
      renderNotesList();
    });
  }

  // Subject filter
  const subjectSelect = container.querySelector('#fe-subject-filter');
  if (subjectSelect) {
    subjectSelect.addEventListener('change', (e) => {
      state.subjectFilter = e.target.value;
      renderNotesList();
    });
  }

  // Sort select
  const sortSelect = container.querySelector('#fe-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const [field, dir] = e.target.value.split('-');
      state.sortBy = field;
      state.sortDir = dir;
      renderNotesList();
    });
  }

  // View mode toggle
  const listBtn = container.querySelector('#fe-view-list');
  const gridBtn = container.querySelector('#fe-view-grid');
  if (listBtn && gridBtn) {
    listBtn.addEventListener('click', () => {
      state.viewMode = 'list';
      listBtn.classList.add('btn--icon-active');
      gridBtn.classList.remove('btn--icon-active');
      renderNotesList();
    });
    gridBtn.addEventListener('click', () => {
      state.viewMode = 'grid';
      gridBtn.classList.add('btn--icon-active');
      listBtn.classList.remove('btn--icon-active');
      renderNotesList();
    });
  }
}

/**
 * Sets up drag-and-drop and file upload conversion
 */
function setupDropZone() {
  const container = state.container;
  const dropZone = container.querySelector('#fe-drop-zone');
  const fileInput = container.querySelector('#fe-file-input');
  const browseBtn = container.querySelector('#fe-browse-btn');

  if (!dropZone || !fileInput) return;

  browseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleFileConversion(file);
      fileInput.value = '';
    }
  });

  // Drag events
  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drop-zone--active');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drop-zone--active');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await handleFileConversion(file);
    }
  });
}

/**
 * Converts dropped/selected document and opens Markdown editor
 * @param {File} file 
 */
async function handleFileConversion(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx'].includes(extension)) {
    showToast('Only .pdf and .docx files are supported for import', 'error');
    return;
  }

  showToast(`Converting ${file.name}...`, 'info');
  
  try {
    const result = await ConverterService.convertFile(file);
    if (!result || !result.markdown) {
      throw new Error('Conversion returned empty content');
    }

    showToast('File converted successfully!', 'success');
    
    // Open markdown editor with imported content
    EventBus.emit('app:open', {
      appId: 'markdown-editor',
      params: {
        importedContent: result.markdown,
        importedTitle: result.title || file.name.replace(/\.[^/.]+$/, '')
      }
    });
  } catch (err) {
    console.error('File conversion error:', err);
    showToast(`Conversion failed: ${err.message || 'Unknown error'}`, 'error');
  }
}

/**
 * Loads notes according to active tab
 */
async function loadNotes() {
  const container = state.container;
  const body = container?.querySelector('#fe-notes-body');
  if (!body) return;

  state.isLoading = true;
  body.innerHTML = `
    <div class="file-explorer__loading">
      <div class="spinner"></div>
      <p>Loading notes...</p>
    </div>
  `;

  try {
    const uid = AppState.user?.uid;
    let fetchedNotes = [];

    if (state.activeTab === 'my-notes') {
      if (uid) {
        fetchedNotes = await FirestoreService.getUserNotes(uid, {});
      } else {
        fetchedNotes = [];
      }
    } else {
      // Public notes
      fetchedNotes = await FirestoreService.getPublicNotes({});
    }

    state.notes = fetchedNotes || [];

    // Extract unique subjects for filter dropdown
    const subjectsSet = new Set();
    state.notes.forEach(note => {
      if (note.subject && note.subject.trim()) {
        subjectsSet.add(note.subject.trim());
      }
    });
    state.subjects = Array.from(subjectsSet).sort();

    updateSubjectDropdown();
    renderNotesList();
  } catch (err) {
    console.error('Error fetching notes:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Failed to load notes</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="fe-retry-btn">Try Again</button>
      </div>
    `;
    container.querySelector('#fe-retry-btn')?.addEventListener('click', loadNotes);
  } finally {
    state.isLoading = false;
  }
}

/**
 * Updates subject filter select options
 */
function updateSubjectDropdown() {
  const container = state.container;
  const select = container?.querySelector('#fe-subject-filter');
  if (!select) return;

  const currentVal = state.subjectFilter;
  let options = '<option value="all">All Subjects</option>';
  state.subjects.forEach(sub => {
    options += `<option value="${escapeHtml(sub)}" ${currentVal === sub ? 'selected' : ''}>${escapeHtml(sub)}</option>`;
  });
  select.innerHTML = options;
}

/**
 * Renders the filtered and sorted notes list/grid
 */
function renderNotesList() {
  const container = state.container;
  const body = container?.querySelector('#fe-notes-body');
  if (!body) return;

  // 1. Filter
  let filtered = state.notes.filter(note => {
    // Subject filter
    if (state.subjectFilter !== 'all' && (note.subject || '').trim() !== state.subjectFilter) {
      return false;
    }
    // Search query filter
    if (state.searchQuery) {
      const q = state.searchQuery;
      const titleMatch = (note.title || '').toLowerCase().includes(q);
      const subjectMatch = (note.subject || '').toLowerCase().includes(q);
      const topicMatch = (note.topic || '').toLowerCase().includes(q);
      const contentMatch = (note.content || '').toLowerCase().includes(q);
      if (!titleMatch && !subjectMatch && !topicMatch && !contentMatch) {
        return false;
      }
    }
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    let comp = 0;
    if (state.sortBy === 'date') {
      const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0));
      const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0));
      comp = timeA - timeB;
    } else if (state.sortBy === 'title') {
      comp = (a.title || '').localeCompare(b.title || '');
    } else if (state.sortBy === 'subject') {
      comp = (a.subject || '').localeCompare(b.subject || '');
    }
    return state.sortDir === 'desc' ? -comp : comp;
  });

  // 3. Render Empty State
  if (filtered.length === 0) {
    const isSearching = !!state.searchQuery || state.subjectFilter !== 'all';
    body.innerHTML = `
      <div class="empty-state">
        <img src="https://img.icons8.com/fluency/48/document.png" alt="" class="empty-state__icon" />
        <h3 class="empty-state__title">${isSearching ? 'No notes match your filters' : (state.activeTab === 'my-notes' ? 'No notes yet' : 'No public notes found')}</h3>
        <p class="empty-state__description">
          ${isSearching 
            ? 'Try clearing your search query or subject filters.' 
            : (state.activeTab === 'my-notes' ? 'Create your first markdown note or drag and drop a PDF/DOCX file above.' : 'Check back later or make one of your notes public.')}
        </p>
        ${state.activeTab === 'my-notes' && !isSearching ? `
          <button class="btn btn--primary" id="fe-empty-new-note">
            <img src="https://img.icons8.com/fluency/18/add.png" alt="" />
            Create Note
          </button>
        ` : ''}
      </div>
    `;
    body.querySelector('#fe-empty-new-note')?.addEventListener('click', () => {
      EventBus.emit('app:open', { appId: 'markdown-editor', params: {} });
    });
    return;
  }

  // 4. Render Items (List or Grid)
  const isGrid = state.viewMode === 'grid';
  let html = `<div class="${isGrid ? 'file-grid' : 'file-list'}">`;

  filtered.forEach(note => {
    const title = escapeHtml(note.title || 'Untitled Note');
    const subject = escapeHtml(note.subject || 'General');
    const topic = note.topic ? escapeHtml(note.topic) : '';
    const charCount = (note.charCount || note.content?.length || 0).toLocaleString();
    const formattedDate = formatTimestamp(note.updatedAt || note.createdAt);
    const isOwner = AppState.user && note.uid === AppState.user.uid;

    if (isGrid) {
      html += `
        <div class="card file-card" data-note-id="${note.id}" tabindex="0">
          <div class="file-card__header">
            <img src="https://img.icons8.com/fluency/32/document.png" alt="" class="file-card__icon" />
            <div class="file-card__badges">
              <span class="badge badge--subject">${subject}</span>
              ${note.isPublic ? '<span class="badge badge--public" title="Public note">Public</span>' : ''}
            </div>
          </div>
          <h4 class="file-card__title" title="${title}">${title}</h4>
          ${topic ? `<p class="file-card__topic">${topic}</p>` : ''}
          <div class="file-card__footer">
            <div class="file-card__meta">
              <span class="file-card__chars">${charCount} chars</span>
              <span class="file-card__date">${formattedDate}</span>
            </div>
            ${isOwner ? `
              <button class="btn btn--icon btn--danger btn-delete-note" data-note-id="${note.id}" title="Delete Note">
                <img src="https://img.icons8.com/fluency/16/delete.png" alt="Delete" />
              </button>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="file-item" data-note-id="${note.id}" tabindex="0">
          <img src="https://img.icons8.com/fluency/24/document.png" alt="" class="file-item__icon" />
          <div class="file-item__info">
            <div class="file-item__title-row">
              <span class="file-item__name">${title}</span>
              <span class="badge badge--subject">${subject}</span>
              ${topic ? `<span class="badge badge--topic">${topic}</span>` : ''}
              ${note.isPublic ? '<span class="badge badge--public">Public</span>' : ''}
            </div>
            <div class="file-item__meta">
              <span>${charCount} chars</span>
              <span>&bull;</span>
              <span>Updated ${formattedDate}</span>
            </div>
          </div>
          <div class="file-item__actions">
            ${isOwner ? `
              <button class="btn btn--icon btn--danger btn-delete-note" data-note-id="${note.id}" title="Delete Note">
                <img src="https://img.icons8.com/fluency/16/delete.png" alt="Delete" />
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }
  });

  html += '</div>';
  body.innerHTML = html;

  // Bind item clicks
  body.querySelectorAll('[data-note-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't open if clicked on delete button
      if (e.target.closest('.btn-delete-note')) return;
      const noteId = el.dataset.noteId;
      EventBus.emit('app:open', { appId: 'markdown-editor', params: { noteId } });
    });
  });

  // Bind delete buttons
  body.querySelectorAll('.btn-delete-note').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.noteId;
      await handleDeleteNote(noteId);
    });
  });
}

/**
 * Handles note deletion with confirmation
 * @param {string} noteId 
 */
async function handleDeleteNote(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  const noteTitle = note?.title || 'this note';

  if (!confirm(`Are you sure you want to delete "${noteTitle}"? This cannot be undone.`)) {
    return;
  }

  try {
    showToast('Deleting note...', 'info');
    await FirestoreService.deleteNote(noteId);
    
    // Log access
    if (AppState.user?.uid) {
      FirestoreService.logAccess({
        uid: AppState.user.uid,
        documentId: noteId,
        documentType: 'note',
        action: 'delete'
      }).catch(console.error);
    }

    EventBus.emit('note:deleted', { noteId });
    showToast('Note deleted successfully', 'success');

    // Remove from local list & re-render
    state.notes = state.notes.filter(n => n.id !== noteId);
    renderNotesList();
    await updateQuotaDisplay();
  } catch (err) {
    console.error('Error deleting note:', err);
    showToast(`Failed to delete note: ${err.message}`, 'error');
  }
}

/**
 * Updates quota usage bar display
 */
async function updateQuotaDisplay() {
  const container = state.container;
  const quotaText = container?.querySelector('#fe-quota-text');
  const quotaFill = container?.querySelector('#fe-quota-fill');
  if (!quotaText || !quotaFill) return;

  const uid = AppState.user?.uid;
  if (!uid) {
    quotaText.textContent = 'Sign in to track quota';
    quotaFill.style.width = '0%';
    return;
  }

  try {
    const quota = await QuotaManager.getQuotaInfo(uid);
    state.quotaInfo = quota;
    const { usedFormatted, limitFormatted, percentage } = QuotaManager.formatQuota(quota.used, quota.limit);

    quotaText.textContent = `${usedFormatted} / ${limitFormatted} chars (${percentage}%)`;
    quotaFill.style.width = `${Math.min(100, percentage)}%`;

    if (percentage >= 90) {
      quotaFill.className = 'quota-bar__fill quota-bar__fill--danger';
    } else if (percentage >= 70) {
      quotaFill.className = 'quota-bar__fill quota-bar__fill--warning';
    } else {
      quotaFill.className = 'quota-bar__fill';
    }
  } catch (err) {
    console.error('Failed to load quota info:', err);
    quotaText.textContent = 'Quota unavailable';
  }
}

/**
 * Sets up EventBus listeners
 */
function setupBusListeners() {
  const onNoteSaved = async () => {
    await loadNotes();
    await updateQuotaDisplay();
  };

  const onNoteDeleted = async () => {
    await updateQuotaDisplay();
  };

  const onQuotaUpdated = () => {
    updateQuotaDisplay();
  };

  EventBus.on('note:saved', onNoteSaved);
  EventBus.on('note:deleted', onNoteDeleted);
  EventBus.on('quota:updated', onQuotaUpdated);

  state.eventHandlers.push(
    { event: 'note:saved', fn: onNoteSaved },
    { event: 'note:deleted', fn: onNoteDeleted },
    { event: 'quota:updated', fn: onQuotaUpdated }
  );
}

/**
 * Cleans up listeners and resources
 */
export function destroy() {
  state.eventHandlers.forEach(({ event, fn }) => {
    EventBus.off(event, fn);
  });
  state.eventHandlers = [];
  state.container = null;
  state.notes = [];
}

/**
 * Helper to escape HTML tags
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Helper to format timestamp
 */
function formatTimestamp(ts) {
  if (!ts) return 'Unknown';
  let date;
  if (ts.toDate && typeof ts.toDate === 'function') {
    date = ts.toDate();
  } else if (ts.seconds) {
    date = new Date(ts.seconds * 1000);
  } else if (ts instanceof Date) {
    date = ts;
  } else {
    date = new Date(ts);
  }

  if (isNaN(date.getTime())) return 'Recently';

  const now = new Date();
  const diffHours = (now - date) / (1000 * 60 * 60);

  if (diffHours < 24 && now.getDate() === date.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
