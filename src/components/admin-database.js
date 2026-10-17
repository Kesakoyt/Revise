/**
 * Admin Database Component
 * Raw collection inspector for Notes, Links, and Users with document JSON inspection,
 * pagination, search filtering, and deletion.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState, showToast } from '../app.js';

// Module state
const state = {
  container: null,
  activeTab: 'notes', // 'notes' | 'links' | 'users'
  searchQuery: '',
  notes: [],
  links: [],
  users: [],
  userMap: {}, // uid -> user profile
  isLoading: false,
  expandedDocId: null,
  currentPage: 1,
  pageSize: 10
};

/**
 * Renders Admin Database panel
 * @param {HTMLElement} container 
 * @param {Object} params 
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('admin-database-container');

  // Render initial layout
  container.innerHTML = `
    <div class="admin-database">
      <!-- Header -->
      <div class="admin-database__header">
        <div class="admin-database__title-wrap">
          <img src="https://img.icons8.com/fluency/28/database.png" alt="" />
          <h2>Database Explorer</h2>
          <span class="badge badge--admin">Admin Only</span>
        </div>
        <div class="admin-database__header-actions">
          <button class="btn btn--secondary" id="db-refresh-btn" title="Refresh collection data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Controls & Tabs -->
      <div class="admin-database__controls">
        <div class="admin-database__tabs">
          <button class="tab-btn ${state.activeTab === 'notes' ? 'tab-btn--active' : ''}" data-tab="notes" id="tab-notes">
            Notes <span class="tab-badge" id="db-notes-count">0</span>
          </button>
          <button class="tab-btn ${state.activeTab === 'links' ? 'tab-btn--active' : ''}" data-tab="links" id="tab-links">
            Links <span class="tab-badge" id="db-links-count">0</span>
          </button>
          <button class="tab-btn ${state.activeTab === 'users' ? 'tab-btn--active' : ''}" data-tab="users" id="tab-users">
            Users <span class="tab-badge" id="db-users-count">0</span>
          </button>
        </div>

        <div class="admin-database__search">
          <img src="https://img.icons8.com/fluency/16/search.png" alt="" class="search-icon" />
          <input 
            type="text" 
            class="input input--search" 
            id="db-search-input" 
            placeholder="Filter current table..." 
            value="${escapeHtml(state.searchQuery)}"
          />
        </div>
      </div>

      <!-- Table Container -->
      <div class="admin-database__body" id="db-table-body">
        <div class="admin-database__loading">
          <div class="spinner"></div>
          <p>Loading database collections...</p>
        </div>
      </div>

      <!-- Pagination / Footer -->
      <div class="admin-database__pagination" id="db-pagination-bar">
        <span class="pagination-info" id="db-page-info">Page 1</span>
        <div class="pagination-controls">
          <button class="btn btn--icon btn--sm" id="db-prev-page" title="Previous Page">&laquo; Prev</button>
          <button class="btn btn--icon btn--sm" id="db-next-page" title="Next Page">Next &raquo;</button>
        </div>
      </div>
    </div>
  `;

  setupListeners();
  await loadAllData();
}

/**
 * Sets up DOM event listeners
 */
function setupListeners() {
  const container = state.container;
  if (!container) return;

  // Tabs
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.tab;
      if (state.activeTab === tab) return;
      state.activeTab = tab;
      state.currentPage = 1;
      state.expandedDocId = null;

      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
      e.currentTarget.classList.add('tab-btn--active');

      renderActiveTable();
    });
  });

  // Search filter
  const searchInput = container.querySelector('#db-search-input');
  let searchTimer = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    state.searchQuery = e.target.value.trim().toLowerCase();
    searchTimer = setTimeout(() => {
      state.currentPage = 1;
      renderActiveTable();
    }, 200);
  });

  // Refresh
  container.querySelector('#db-refresh-btn')?.addEventListener('click', async () => {
    await loadAllData();
  });

  // Pagination buttons
  container.querySelector('#db-prev-page')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderActiveTable();
    }
  });

  container.querySelector('#db-next-page')?.addEventListener('click', () => {
    const items = getActiveItemsFiltered();
    const maxPages = Math.ceil(items.length / state.pageSize) || 1;
    if (state.currentPage < maxPages) {
      state.currentPage++;
      renderActiveTable();
    }
  });
}

/**
 * Loads all collections from Firestore
 */
async function loadAllData() {
  const container = state.container;
  const body = container?.querySelector('#db-table-body');
  if (!body) return;

  state.isLoading = true;
  body.innerHTML = `
    <div class="admin-database__loading">
      <div class="spinner"></div>
      <p>Loading database collections...</p>
    </div>
  `;

  try {
    const [notes, links, users] = await Promise.all([
      FirestoreService.getAllNotes().catch(err => {
        console.warn('Failed to load notes:', err);
        return [];
      }),
      FirestoreService.getAllLinks().catch(err => {
        console.warn('Failed to load links:', err);
        return [];
      }),
      FirestoreService.getAllUsers().catch(err => {
        console.warn('Failed to load users:', err);
        return [];
      })
    ]);

    state.notes = notes || [];
    state.links = links || [];
    state.users = users || [];

    // Build user map for fast displayName lookup
    state.userMap = {};
    state.users.forEach(u => {
      state.userMap[u.id || u.uid] = u.displayName || u.email || 'User ' + (u.id || u.uid).substring(0, 5);
    });

    // Update count badges
    const notesCount = container.querySelector('#db-notes-count');
    const linksCount = container.querySelector('#db-links-count');
    const usersCount = container.querySelector('#db-users-count');

    if (notesCount) notesCount.textContent = state.notes.length;
    if (linksCount) linksCount.textContent = state.links.length;
    if (usersCount) usersCount.textContent = state.users.length;

    renderActiveTable();
  } catch (err) {
    console.error('Error in loadAllData:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Failed to load collections</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
      </div>
    `;
  } finally {
    state.isLoading = false;
  }
}

/**
 * Returns filtered items according to active tab and search query
 */
function getActiveItemsFiltered() {
  const q = state.searchQuery;
  let items = [];

  if (state.activeTab === 'notes') {
    items = state.notes.filter(n => {
      if (!q) return true;
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const subjectMatch = (n.subject || '').toLowerCase().includes(q);
      const ownerMatch = (state.userMap[n.uid] || n.uid || '').toLowerCase().includes(q);
      return titleMatch || subjectMatch || ownerMatch;
    });
  } else if (state.activeTab === 'links') {
    items = state.links.filter(l => {
      if (!q) return true;
      const titleMatch = (l.title || '').toLowerCase().includes(q);
      const urlMatch = (l.url || '').toLowerCase().includes(q);
      const subjectMatch = (l.subject || '').toLowerCase().includes(q);
      const ownerMatch = (state.userMap[l.uid] || l.uid || '').toLowerCase().includes(q);
      return titleMatch || urlMatch || subjectMatch || ownerMatch;
    });
  } else {
    items = state.users.filter(u => {
      if (!q) return true;
      const emailMatch = (u.email || '').toLowerCase().includes(q);
      const nameMatch = (u.displayName || '').toLowerCase().includes(q);
      const roleMatch = (u.role || '').toLowerCase().includes(q);
      return emailMatch || nameMatch || roleMatch;
    });
  }

  return items;
}

/**
 * Renders the table for the current tab with pagination
 */
function renderActiveTable() {
  const container = state.container;
  const body = container?.querySelector('#db-table-body');
  const pageInfo = container?.querySelector('#db-page-info');
  const prevBtn = container?.querySelector('#db-prev-page');
  const nextBtn = container?.querySelector('#db-next-page');

  if (!body) return;

  const allFiltered = getActiveItemsFiltered();
  const total = allFiltered.length;
  const maxPages = Math.ceil(total / state.pageSize) || 1;

  if (state.currentPage > maxPages) state.currentPage = maxPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIndex = (state.currentPage - 1) * state.pageSize;
  const pageItems = allFiltered.slice(startIndex, startIndex + state.pageSize);

  if (pageInfo) {
    pageInfo.textContent = `Showing ${total === 0 ? 0 : startIndex + 1}-${Math.min(startIndex + state.pageSize, total)} of ${total}`;
  }
  if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
  if (nextBtn) nextBtn.disabled = state.currentPage >= maxPages;

  if (pageItems.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">No documents found</p>
        <p class="empty-state__description">No documents matched your query in the ${state.activeTab} collection.</p>
      </div>
    `;
    return;
  }

  let tableHtml = '<div class="table-responsive"><table class="table">';

  if (state.activeTab === 'notes') {
    tableHtml += `
      <thead>
        <tr class="table__header">
          <th>Title</th>
          <th>Owner</th>
          <th>Subject</th>
          <th>Chars</th>
          <th>Public</th>
          <th>Created</th>
          <th class="table__cell--actions">Actions</th>
        </tr>
      </thead>
      <tbody>
    `;

    pageItems.forEach(note => {
      const isExpanded = state.expandedDocId === note.id;
      const ownerName = escapeHtml(state.userMap[note.uid] || note.uid || 'Anonymous');
      const formattedDate = formatTimestamp(note.createdAt);

      tableHtml += `
        <tr class="table__row ${isExpanded ? 'table__row--expanded' : ''}" data-doc-id="${note.id}">
          <td class="table__cell font-semibold" title="${escapeHtml(note.title)}">${escapeHtml(truncate(note.title || 'Untitled', 30))}</td>
          <td class="table__cell text-secondary" title="${escapeHtml(note.uid)}">${ownerName}</td>
          <td class="table__cell"><span class="badge badge--subject">${escapeHtml(note.subject || 'General')}</span></td>
          <td class="table__cell">${(note.charCount || note.content?.length || 0).toLocaleString()}</td>
          <td class="table__cell">${note.isPublic ? '<span class="badge badge--public">Yes</span>' : '<span class="text-tertiary">No</span>'}</td>
          <td class="table__cell text-secondary">${formattedDate}</td>
          <td class="table__cell table__cell--actions">
            <button class="btn btn--sm btn-view-json" data-doc-id="${note.id}" title="Toggle JSON Inspector">JSON</button>
            <button class="btn btn--sm btn--danger btn-delete-doc" data-doc-id="${note.id}" data-type="note" title="Delete Note">
              <img src="https://img.icons8.com/fluency/14/delete.png" alt="Del" />
            </button>
          </td>
        </tr>
        ${isExpanded ? renderJsonRow(note, 7) : ''}
      `;
    });
  } else if (state.activeTab === 'links') {
    tableHtml += `
      <thead>
        <tr class="table__header">
          <th>Title</th>
          <th>URL</th>
          <th>Owner</th>
          <th>Subject</th>
          <th>Created</th>
          <th class="table__cell--actions">Actions</th>
        </tr>
      </thead>
      <tbody>
    `;

    pageItems.forEach(link => {
      const isExpanded = state.expandedDocId === link.id;
      const ownerName = escapeHtml(state.userMap[link.uid] || link.uid || 'Anonymous');
      const formattedDate = formatTimestamp(link.createdAt);

      tableHtml += `
        <tr class="table__row ${isExpanded ? 'table__row--expanded' : ''}" data-doc-id="${link.id}">
          <td class="table__cell font-semibold" title="${escapeHtml(link.title)}">${escapeHtml(truncate(link.title || 'Untitled', 25))}</td>
          <td class="table__cell">
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="link-url-cell" title="${escapeHtml(link.url)}">
              ${escapeHtml(truncate(link.url, 30))}
            </a>
          </td>
          <td class="table__cell text-secondary">${ownerName}</td>
          <td class="table__cell"><span class="badge badge--subject">${escapeHtml(link.subject || 'General')}</span></td>
          <td class="table__cell text-secondary">${formattedDate}</td>
          <td class="table__cell table__cell--actions">
            <button class="btn btn--sm btn-view-json" data-doc-id="${link.id}" title="Toggle JSON Inspector">JSON</button>
            <button class="btn btn--sm btn--danger btn-delete-doc" data-doc-id="${link.id}" data-type="link" title="Delete Link">
              <img src="https://img.icons8.com/fluency/14/delete.png" alt="Del" />
            </button>
          </td>
        </tr>
        ${isExpanded ? renderJsonRow(link, 6) : ''}
      `;
    });
  } else {
    // Users
    tableHtml += `
      <thead>
        <tr class="table__header">
          <th>Email</th>
          <th>Display Name</th>
          <th>Role</th>
          <th>Quota Used</th>
          <th>Last Login</th>
          <th class="table__cell--actions">Actions</th>
        </tr>
      </thead>
      <tbody>
    `;

    pageItems.forEach(user => {
      const isExpanded = state.expandedDocId === (user.id || user.uid);
      const quotaPct = user.quotaLimit ? Math.round(((user.quotaUsed || 0) / user.quotaLimit) * 100) : 0;
      const lastLoginFormatted = formatTimestamp(user.lastLogin);

      tableHtml += `
        <tr class="table__row ${isExpanded ? 'table__row--expanded' : ''}" data-doc-id="${user.id || user.uid}">
          <td class="table__cell font-semibold">${escapeHtml(user.email || 'No email')}</td>
          <td class="table__cell">${escapeHtml(user.displayName || 'No name')}</td>
          <td class="table__cell">
            <span class="badge ${user.role === 'admin' ? 'badge--admin' : 'badge--user'}">
              ${escapeHtml(user.role || 'user')}
            </span>
          </td>
          <td class="table__cell">
            <div class="user-quota-mini">
              <span>${(user.quotaUsed || 0).toLocaleString()} / ${(user.quotaLimit || 500000).toLocaleString()}</span>
              <span class="text-tertiary">(${quotaPct}%)</span>
            </div>
          </td>
          <td class="table__cell text-secondary">${lastLoginFormatted}</td>
          <td class="table__cell table__cell--actions">
            <button class="btn btn--sm btn-view-json" data-doc-id="${user.id || user.uid}" title="Toggle JSON Inspector">JSON</button>
          </td>
        </tr>
        ${isExpanded ? renderJsonRow(user, 6) : ''}
      `;
    });
  }

  tableHtml += '</tbody></table></div>';
  body.innerHTML = tableHtml;

  // Row / Button click bindings
  bindTableInteractions();
}

/**
 * Returns formatted JSON inspection subrow
 */
function renderJsonRow(doc, colSpan) {
  const cleanDoc = { ...doc };
  // Convert timestamps to string preview for clean JSON display
  for (const k in cleanDoc) {
    if (cleanDoc[k]?.toDate && typeof cleanDoc[k].toDate === 'function') {
      cleanDoc[k] = cleanDoc[k].toDate().toISOString();
    }
  }

  const jsonStr = JSON.stringify(cleanDoc, null, 2);

  return `
    <tr class="table__row--json-viewer">
      <td colspan="${colSpan}">
        <div class="json-inspector">
          <div class="json-inspector__header">
            <span>Document ID: <code>${escapeHtml(doc.id || doc.uid)}</code></span>
            <button class="btn btn--sm btn-copy-json" data-json="${escapeHtml(jsonStr)}">Copy JSON</button>
          </div>
          <pre class="json-code"><code>${escapeHtml(jsonStr)}</code></pre>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Attaches row actions (JSON toggle, Copy, Delete)
 */
function bindTableInteractions() {
  const container = state.container;
  if (!container) return;

  // Toggle JSON on button or row click
  container.querySelectorAll('.btn-view-json').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const docId = btn.dataset.docId;
      state.expandedDocId = state.expandedDocId === docId ? null : docId;
      renderActiveTable();
    });
  });

  // Copy JSON
  container.querySelectorAll('.btn-copy-json').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const raw = btn.dataset.json;
      if (raw) {
        navigator.clipboard.writeText(raw).then(() => {
          showToast('JSON copied to clipboard', 'info');
        }).catch(() => {
          showToast('Could not copy JSON', 'error');
        });
      }
    });
  });

  // Delete document
  container.querySelectorAll('.btn-delete-doc').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const docId = btn.dataset.docId;
      const docType = btn.dataset.type;
      await handleDeleteDoc(docId, docType);
    });
  });
}

/**
 * Handles deletion from table
 */
async function handleDeleteDoc(docId, docType) {
  if (!confirm(`Are you sure you want to permanently delete this ${docType} (${docId})?`)) {
    return;
  }

  try {
    showToast(`Deleting ${docType}...`, 'info');
    if (docType === 'note') {
      await FirestoreService.deleteNote(docId);
      state.notes = state.notes.filter(n => n.id !== docId);
      EventBus.emit('note:deleted', { noteId: docId });
    } else if (docType === 'link') {
      await FirestoreService.deleteLink(docId);
      state.links = state.links.filter(l => l.id !== docId);
      EventBus.emit('link:deleted', { linkId: docId });
    }

    showToast(`${docType} deleted successfully`, 'success');
    renderActiveTable();
  } catch (err) {
    console.error('Failed to delete document:', err);
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

/**
 * Destroy cleanup
 */
export function destroy() {
  state.container = null;
  state.notes = [];
  state.links = [];
  state.users = [];
  state.userMap = {};
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

function truncate(str, max = 25) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function formatTimestamp(ts) {
  if (!ts) return '-';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);

  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
