/**
 * Link Manager Component
 * Manage external web resources, preview favicons, search/filter, and perform CRUD operations.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState, showToast } from '../app.js';

// Module-level state
const state = {
  container: null,
  links: [],
  subjects: [],
  subjectFilter: 'all',
  searchQuery: '',
  isFormOpen: false,
  editingLinkId: null,
  isLoading: false,
  eventHandlers: []
};

/**
 * Renders Link Manager component in container
 * @param {HTMLElement} container 
 * @param {Object} params 
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('link-manager-container');

  // Build UI skeleton
  container.innerHTML = `
    <div class="link-manager">
      <!-- Header -->
      <div class="link-manager__header">
        <div class="link-manager__title-wrap">
          <img src="https://img.icons8.com/fluency/28/link.png" alt="" />
          <h2>My Links</h2>
        </div>
        <button class="btn btn--primary" id="lm-add-link-btn">
          <img src="https://img.icons8.com/fluency/18/add.png" alt="" />
          <span>Add Link</span>
        </button>
      </div>

      <!-- Add / Edit Form Card (Collapsible) -->
      <div class="card link-manager__form-card" id="lm-form-card" style="display: none;">
        <div class="link-manager__form-header">
          <h3 id="lm-form-title">Add New Link</h3>
          <button type="button" class="btn btn--icon" id="lm-form-close-btn">&times;</button>
        </div>
        <form class="link-manager__form" id="lm-form" onsubmit="return false;">
          <input type="hidden" id="lm-form-id" value="" />
          <div class="form-grid">
            <div class="form-group form-group--wide">
              <label for="lm-input-url" class="form-label">URL <span class="required">*</span></label>
              <input 
                type="url" 
                class="input" 
                id="lm-input-url" 
                placeholder="https://example.com/article" 
                required 
              />
            </div>
            <div class="form-group">
              <label for="lm-input-title" class="form-label">Title <span class="required">*</span></label>
              <input 
                type="text" 
                class="input" 
                id="lm-input-title" 
                placeholder="Page Title or Resource Name" 
                required 
              />
            </div>
            <div class="form-group">
              <label for="lm-input-subject" class="form-label">Subject</label>
              <input 
                type="text" 
                class="input" 
                id="lm-input-subject" 
                list="lm-subject-suggestions" 
                placeholder="e.g. Computer Science, Research" 
              />
              <datalist id="lm-subject-suggestions"></datalist>
            </div>
            <div class="form-group form-group--wide">
              <label for="lm-input-desc" class="form-label">Description (Optional)</label>
              <textarea 
                class="textarea" 
                id="lm-input-desc" 
                rows="2" 
                placeholder="Brief summary or notes about this link..."
              ></textarea>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn--secondary" id="lm-form-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary" id="lm-form-save">
              <img src="https://img.icons8.com/fluency/16/save.png" alt="" />
              <span id="lm-form-save-text">Save Link</span>
            </button>
          </div>
        </form>
      </div>

      <!-- Toolbar / Filters -->
      <div class="link-manager__toolbar">
        <div class="link-manager__search-wrap">
          <img src="https://img.icons8.com/fluency/18/search.png" alt="" class="search-icon" />
          <input 
            type="text" 
            class="input input--search" 
            id="lm-search-input" 
            placeholder="Search links by title, url, or subject..." 
            value="${escapeHtml(state.searchQuery)}"
          />
        </div>

        <div class="link-manager__filter-wrap">
          <select class="input select" id="lm-subject-filter">
            <option value="all">All Subjects</option>
          </select>
        </div>
      </div>

      <!-- Links Grid / List -->
      <div class="link-manager__body" id="lm-links-body">
        <div class="link-manager__loading">
          <div class="spinner"></div>
          <p>Loading links...</p>
        </div>
      </div>
    </div>
  `;

  // Attach Listeners
  setupFormListeners();
  setupToolbarListeners();
  setupBusListeners();

  // Load Links
  await loadLinks();
}

/**
 * Loads user links from Firestore
 */
async function loadLinks() {
  const container = state.container;
  const body = container?.querySelector('#lm-links-body');
  if (!body) return;

  const uid = AppState.user?.uid;
  if (!uid) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Sign In Required</p>
        <p class="empty-state__description">Please sign in to view and manage your saved links.</p>
      </div>
    `;
    return;
  }

  state.isLoading = true;

  try {
    const fetchedLinks = await FirestoreService.getUserLinks(uid, {});
    state.links = fetchedLinks || [];

    // Extract subjects
    const subjectsSet = new Set();
    state.links.forEach(l => {
      if (l.subject && l.subject.trim()) {
        subjectsSet.add(l.subject.trim());
      }
    });
    state.subjects = Array.from(subjectsSet).sort();

    updateSubjectDropdowns();
    renderLinks();
  } catch (err) {
    console.error('Error loading links:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Failed to load links</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="lm-retry-btn">Try Again</button>
      </div>
    `;
    container.querySelector('#lm-retry-btn')?.addEventListener('click', loadLinks);
  } finally {
    state.isLoading = false;
  }
}

/**
 * Updates filter select and suggestions datalist
 */
function updateSubjectDropdowns() {
  const container = state.container;
  const filterSelect = container?.querySelector('#lm-subject-filter');
  const suggestions = container?.querySelector('#lm-subject-suggestions');

  if (filterSelect) {
    let opts = '<option value="all">All Subjects</option>';
    state.subjects.forEach(sub => {
      opts += `<option value="${escapeHtml(sub)}" ${state.subjectFilter === sub ? 'selected' : ''}>${escapeHtml(sub)}</option>`;
    });
    filterSelect.innerHTML = opts;
  }

  if (suggestions) {
    let datalist = '';
    state.subjects.forEach(sub => {
      datalist += `<option value="${escapeHtml(sub)}">`;
    });
    suggestions.innerHTML = datalist;
  }
}

/**
 * Sets up toolbar and search input handlers
 */
function setupToolbarListeners() {
  const container = state.container;
  if (!container) return;

  const searchInput = container.querySelector('#lm-search-input');
  let searchTimeout = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    state.searchQuery = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(() => {
      renderLinks();
    }, 250);
  });

  const filterSelect = container.querySelector('#lm-subject-filter');
  filterSelect?.addEventListener('change', (e) => {
    state.subjectFilter = e.target.value;
    renderLinks();
  });

  const addBtn = container.querySelector('#lm-add-link-btn');
  addBtn?.addEventListener('click', () => {
    openForm();
  });
}

/**
 * Sets up form handlers for create/edit
 */
function setupFormListeners() {
  const container = state.container;
  if (!container) return;

  const form = container.querySelector('#lm-form');
  const closeBtn = container.querySelector('#lm-form-close-btn');
  const cancelBtn = container.querySelector('#lm-form-cancel');

  closeBtn?.addEventListener('click', closeForm);
  cancelBtn?.addEventListener('click', closeForm);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit();
  });
}

/**
 * Opens form in Add or Edit mode
 * @param {Object|null} linkToEdit 
 */
function openForm(linkToEdit = null) {
  const container = state.container;
  const formCard = container?.querySelector('#lm-form-card');
  const formTitle = container?.querySelector('#lm-form-title');
  const saveText = container?.querySelector('#lm-form-save-text');
  const idInput = container?.querySelector('#lm-form-id');
  const urlInput = container?.querySelector('#lm-input-url');
  const titleInput = container?.querySelector('#lm-input-title');
  const subjectInput = container?.querySelector('#lm-input-subject');
  const descInput = container?.querySelector('#lm-input-desc');

  if (!formCard) return;

  if (linkToEdit) {
    state.editingLinkId = linkToEdit.id;
    if (formTitle) formTitle.textContent = 'Edit Link';
    if (saveText) saveText.textContent = 'Update Link';
    if (idInput) idInput.value = linkToEdit.id;
    if (urlInput) urlInput.value = linkToEdit.url || '';
    if (titleInput) titleInput.value = linkToEdit.title || '';
    if (subjectInput) subjectInput.value = linkToEdit.subject || '';
    if (descInput) descInput.value = linkToEdit.description || '';
  } else {
    state.editingLinkId = null;
    if (formTitle) formTitle.textContent = 'Add New Link';
    if (saveText) saveText.textContent = 'Save Link';
    if (idInput) idInput.value = '';
    if (urlInput) urlInput.value = '';
    if (titleInput) titleInput.value = '';
    if (subjectInput) subjectInput.value = '';
    if (descInput) descInput.value = '';
  }

  formCard.style.display = 'block';
  urlInput?.focus();
  state.isFormOpen = true;
}

/**
 * Closes the link form
 */
function closeForm() {
  const container = state.container;
  const formCard = container?.querySelector('#lm-form-card');
  if (formCard) formCard.style.display = 'none';
  state.isFormOpen = false;
  state.editingLinkId = null;
}

/**
 * Handles link form submission
 */
async function handleFormSubmit() {
  const container = state.container;
  const urlInput = container?.querySelector('#lm-input-url');
  const titleInput = container?.querySelector('#lm-input-title');
  const subjectInput = container?.querySelector('#lm-input-subject');
  const descInput = container?.querySelector('#lm-input-desc');
  const saveBtn = container?.querySelector('#lm-form-save');

  let rawUrl = (urlInput?.value || '').trim();
  const title = (titleInput?.value || '').trim();
  const subject = (subjectInput?.value || '').trim() || 'General';
  const description = (descInput?.value || '').trim();

  if (!rawUrl) {
    showToast('Please enter a URL', 'error');
    urlInput?.focus();
    return;
  }

  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = 'https://' + rawUrl;
  }

  try {
    new URL(rawUrl);
  } catch {
    showToast('Please enter a valid URL address', 'error');
    urlInput?.focus();
    return;
  }

  if (!title) {
    showToast('Please enter a title for the link', 'error');
    titleInput?.focus();
    return;
  }

  const uid = AppState.user?.uid;
  if (!uid) {
    showToast('You must be signed in to save links', 'error');
    return;
  }

  if (saveBtn) saveBtn.disabled = true;

  try {
    if (state.editingLinkId) {
      // Update existing
      await FirestoreService.updateLink(state.editingLinkId, {
        title,
        url: rawUrl,
        description,
        subject
      });

      // Log access
      FirestoreService.logAccess({
        uid,
        documentId: state.editingLinkId,
        documentType: 'link',
        action: 'edit'
      }).catch(console.error);

      EventBus.emit('link:saved', { linkId: state.editingLinkId });
      showToast('Link updated successfully', 'success');
    } else {
      // Create new
      const newId = await FirestoreService.createLink({
        uid,
        title,
        url: rawUrl,
        description,
        subject
      });

      // Log access
      FirestoreService.logAccess({
        uid,
        documentId: newId,
        documentType: 'link',
        action: 'create'
      }).catch(console.error);

      EventBus.emit('link:saved', { linkId: newId });
      showToast('Link created successfully', 'success');
    }

    closeForm();
    await loadLinks();
  } catch (err) {
    console.error('Failed to save link:', err);
    showToast(`Error saving link: ${err.message}`, 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

/**
 * Renders the links cards
 */
function renderLinks() {
  const container = state.container;
  const body = container?.querySelector('#lm-links-body');
  if (!body) return;

  // Filter
  let filtered = state.links.filter(link => {
    if (state.subjectFilter !== 'all' && (link.subject || '').trim() !== state.subjectFilter) {
      return false;
    }
    if (state.searchQuery) {
      const q = state.searchQuery;
      const titleMatch = (link.title || '').toLowerCase().includes(q);
      const urlMatch = (link.url || '').toLowerCase().includes(q);
      const descMatch = (link.description || '').toLowerCase().includes(q);
      const subjectMatch = (link.subject || '').toLowerCase().includes(q);
      if (!titleMatch && !urlMatch && !descMatch && !subjectMatch) {
        return false;
      }
    }
    return true;
  });

  // Empty state
  if (filtered.length === 0) {
    const isSearching = !!state.searchQuery || state.subjectFilter !== 'all';
    body.innerHTML = `
      <div class="empty-state">
        <img src="https://img.icons8.com/fluency/48/link.png" alt="" class="empty-state__icon" />
        <h3 class="empty-state__title">${isSearching ? 'No links match your filters' : 'No links saved yet'}</h3>
        <p class="empty-state__description">
          ${isSearching ? 'Try clearing your search term or subject filter.' : 'Bookmark web pages, documentation, and references here.'}
        </p>
        ${!isSearching ? `
          <button class="btn btn--primary" id="lm-empty-add-btn">
            <img src="https://img.icons8.com/fluency/18/add.png" alt="" />
            Add First Link
          </button>
        ` : ''}
      </div>
    `;
    body.querySelector('#lm-empty-add-btn')?.addEventListener('click', () => openForm());
    return;
  }

  // Cards layout
  let html = '<div class="links-grid">';
  filtered.forEach(link => {
    const title = escapeHtml(link.title || 'Untitled Link');
    const url = escapeHtml(link.url || '#');
    const desc = link.description ? escapeHtml(link.description) : '';
    const subject = escapeHtml(link.subject || 'General');

    let domain = '';
    try {
      domain = new URL(link.url).hostname;
    } catch {
      domain = 'external';
    }

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    html += `
      <div class="card link-card" data-link-id="${link.id}" data-url="${url}">
        <div class="link-card__header">
          <div class="link-card__favicon-wrap">
            <img 
              src="${faviconUrl}" 
              alt="" 
              class="link-card__favicon" 
              onerror="this.src='https://img.icons8.com/fluency/32/link.png'"
            />
          </div>
          <div class="link-card__title-meta">
            <h4 class="link-card__title" title="${title}">${title}</h4>
            <span class="link-card__domain">${domain}</span>
          </div>
          <span class="badge badge--subject">${subject}</span>
        </div>

        ${desc ? `<p class="link-card__description">${desc}</p>` : '<div class="link-card__spacer"></div>'}

        <div class="link-card__footer">
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="link-card__url" title="${url}">
            <span>${truncate(link.url, 40)}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          <div class="link-card__actions">
            <button class="btn btn--icon btn-edit-link" data-link-id="${link.id}" title="Edit Link">
              <img src="https://img.icons8.com/fluency/16/edit.png" alt="Edit" />
            </button>
            <button class="btn btn--icon btn--danger btn-delete-link" data-link-id="${link.id}" title="Delete Link">
              <img src="https://img.icons8.com/fluency/16/delete.png" alt="Delete" />
            </button>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  body.innerHTML = html;

  // Click card to open in new tab (unless clicked action button or direct <a>)
  body.querySelectorAll('.link-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-edit-link') || e.target.closest('.btn-delete-link') || e.target.closest('a')) {
        return;
      }
      const rawUrl = card.dataset.url;
      if (rawUrl) {
        window.open(rawUrl, '_blank', 'noopener,noreferrer');
      }
    });
  });

  // Edit button
  body.querySelectorAll('.btn-edit-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const linkId = btn.dataset.linkId;
      const link = state.links.find(l => l.id === linkId);
      if (link) {
        openForm(link);
      }
    });
  });

  // Delete button
  body.querySelectorAll('.btn-delete-link').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const linkId = btn.dataset.linkId;
      await handleDeleteLink(linkId);
    });
  });
}

/**
 * Handles link deletion
 * @param {string} linkId 
 */
async function handleDeleteLink(linkId) {
  const link = state.links.find(l => l.id === linkId);
  const title = link?.title || 'this link';

  if (!confirm(`Are you sure you want to delete "${title}"?`)) {
    return;
  }

  try {
    showToast('Deleting link...', 'info');
    await FirestoreService.deleteLink(linkId);

    if (AppState.user?.uid) {
      FirestoreService.logAccess({
        uid: AppState.user.uid,
        documentId: linkId,
        documentType: 'link',
        action: 'delete'
      }).catch(console.error);
    }

    EventBus.emit('link:deleted', { linkId });
    showToast('Link deleted successfully', 'success');

    state.links = state.links.filter(l => l.id !== linkId);
    renderLinks();
  } catch (err) {
    console.error('Failed to delete link:', err);
    showToast(`Error deleting link: ${err.message}`, 'error');
  }
}

/**
 * Sets up EventBus listeners
 */
function setupBusListeners() {
  const onSaved = async () => {
    await loadLinks();
  };
  const onDeleted = async () => {
    await loadLinks();
  };

  EventBus.on('link:saved', onSaved);
  EventBus.on('link:deleted', onDeleted);

  state.eventHandlers.push(
    { event: 'link:saved', fn: onSaved },
    { event: 'link:deleted', fn: onDeleted }
  );
}

/**
 * Cleans up listeners
 */
export function destroy() {
  state.eventHandlers.forEach(({ event, fn }) => {
    EventBus.off(event, fn);
  });
  state.eventHandlers = [];
  state.container = null;
  state.links = [];
}

/**
 * Helpers
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

function truncate(str, max = 35) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}
