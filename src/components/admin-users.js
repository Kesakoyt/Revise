/**
 * Admin Users Component
 * User management interface for viewing registered accounts, modifying roles,
 * and inspecting user documents (notes, links) and recent access logs.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { AuthService } from '../services/auth-service.js';
import { EventBus, AppState, showToast } from '../app.js';

// Component state
const state = {
  container: null,
  users: [],
  searchQuery: '',
  selectedUserId: null,
  userDetails: {
    notes: [],
    links: [],
    logs: [],
    isLoading: false
  },
  activeDetailTab: 'notes', // 'notes' | 'links' | 'logs'
  isLoading: false
};

/**
 * Renders Admin Users panel
 * @param {HTMLElement} container 
 * @param {Object} params 
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('admin-users-container');

  // Build skeleton UI
  container.innerHTML = `
    <div class="admin-users">
      <!-- Header -->
      <div class="admin-users__header">
        <div class="admin-users__title-wrap">
          <img src="https://img.icons8.com/fluency/28/group.png" alt="" />
          <h2>User Management</h2>
          <span class="badge badge--admin">Admin Only</span>
        </div>
        <div class="admin-users__header-actions">
          <button class="btn btn--secondary" id="au-refresh-btn" title="Refresh user list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Search & Filters -->
      <div class="admin-users__toolbar">
        <div class="admin-users__search">
          <img src="https://img.icons8.com/fluency/16/search.png" alt="" class="search-icon" />
          <input 
            type="text" 
            class="input input--search" 
            id="au-search-input" 
            placeholder="Search users by name or email..." 
            value="${escapeHtml(state.searchQuery)}"
          />
        </div>
        <div class="admin-users__count" id="au-users-count">
          0 users registered
        </div>
      </div>

      <!-- Users Table & Details Container -->
      <div class="admin-users__content">
        <div class="admin-users__table-wrap" id="au-table-container">
          <div class="admin-users__loading">
            <div class="spinner"></div>
            <p>Loading users...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  setupListeners();
  await loadUsers();
}

/**
 * Sets up event listeners
 */
function setupListeners() {
  const container = state.container;
  if (!container) return;

  // Search input
  const searchInput = container.querySelector('#au-search-input');
  let searchTimer = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    state.searchQuery = e.target.value.trim().toLowerCase();
    searchTimer = setTimeout(() => {
      renderUserTable();
    }, 200);
  });

  // Refresh button
  container.querySelector('#au-refresh-btn')?.addEventListener('click', async () => {
    await loadUsers();
  });
}

/**
 * Loads all users from Firestore
 */
async function loadUsers() {
  const container = state.container;
  const tableWrap = container?.querySelector('#au-table-container');
  if (!tableWrap) return;

  state.isLoading = true;
  tableWrap.innerHTML = `
    <div class="admin-users__loading">
      <div class="spinner"></div>
      <p>Loading users...</p>
    </div>
  `;

  try {
    const users = await FirestoreService.getAllUsers();
    state.users = users || [];

    const countEl = container.querySelector('#au-users-count');
    if (countEl) {
      countEl.textContent = `${state.users.length} ${state.users.length === 1 ? 'user' : 'users'} registered`;
    }

    renderUserTable();
  } catch (err) {
    console.error('Failed to load users:', err);
    tableWrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Failed to load users</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
      </div>
    `;
  } finally {
    state.isLoading = false;
  }
}

/**
 * Renders user table and expandable detail drawer
 */
function renderUserTable() {
  const container = state.container;
  const tableWrap = container?.querySelector('#au-table-container');
  if (!tableWrap) return;

  // Filter
  const q = state.searchQuery;
  const filtered = state.users.filter(u => {
    if (!q) return true;
    const nameMatch = (u.displayName || '').toLowerCase().includes(q);
    const emailMatch = (u.email || '').toLowerCase().includes(q);
    const roleMatch = (u.role || '').toLowerCase().includes(q);
    return nameMatch || emailMatch || roleMatch;
  });

  if (filtered.length === 0) {
    tableWrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">No users found</p>
        <p class="empty-state__description">No users match "${escapeHtml(q)}"</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="table-responsive">
      <table class="table user-table">
        <thead>
          <tr class="table__header">
            <th>User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Quota Usage</th>
            <th>Last Login</th>
            <th class="table__cell--actions">Details</th>
          </tr>
        </thead>
        <tbody>
  `;

  filtered.forEach(user => {
    const uid = user.id || user.uid;
    const displayName = user.displayName || 'Unnamed User';
    const email = user.email || 'No email';
    const role = user.role || 'user';
    const quotaUsed = user.quotaUsed || 0;
    const quotaLimit = user.quotaLimit || 500000;
    const percentage = Math.min(100, Math.round((quotaUsed / quotaLimit) * 100));
    const lastLogin = formatTimestamp(user.lastLogin);
    const initials = getInitials(displayName, email);
    const isSelected = state.selectedUserId === uid;

    html += `
      <tr class="table__row ${isSelected ? 'table__row--selected' : ''}" data-uid="${uid}">
        <td class="table__cell">
          <div class="user-cell">
            <div class="avatar-placeholder">${initials}</div>
            <div class="user-cell__names">
              <span class="user-cell__name">${escapeHtml(displayName)}</span>
              <span class="user-cell__id text-tertiary">ID: ${escapeHtml(uid.substring(0, 8))}...</span>
            </div>
          </div>
        </td>
        <td class="table__cell text-secondary">${escapeHtml(email)}</td>
        <td class="table__cell">
          <select class="input select select--sm role-select" data-uid="${uid}" aria-label="User role">
            <option value="user" ${role === 'user' ? 'selected' : ''}>User</option>
            <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
        <td class="table__cell">
          <div class="quota-mini-meter">
            <div class="quota-mini-meter__track">
              <div class="quota-mini-meter__bar" style="width: ${percentage}%"></div>
            </div>
            <span class="quota-mini-meter__label">${quotaUsed.toLocaleString()} / ${quotaLimit.toLocaleString()} (${percentage}%)</span>
          </div>
        </td>
        <td class="table__cell text-secondary">${lastLogin}</td>
        <td class="table__cell table__cell--actions">
          <button class="btn btn--sm ${isSelected ? 'btn--primary' : 'btn--secondary'} btn-toggle-details" data-uid="${uid}">
            ${isSelected ? 'Hide' : 'Inspect'}
          </button>
        </td>
      </tr>
      ${isSelected ? renderUserDetailRow(user) : ''}
    `;
  });

  html += '</tbody></table></div>';
  tableWrap.innerHTML = html;

  bindTableInteractions();
}

/**
 * Renders expanded detail row for a user
 */
function renderUserDetailRow(user) {
  const uid = user.id || user.uid;
  const { notes, links, logs, isLoading } = state.userDetails;

  return `
    <tr class="table__row--user-expanded">
      <td colspan="6">
        <div class="user-expanded-panel">
          <div class="user-expanded-tabs">
            <button class="user-tab-btn ${state.activeDetailTab === 'notes' ? 'user-tab-btn--active' : ''}" data-detail-tab="notes">
              User Notes (${notes.length})
            </button>
            <button class="user-tab-btn ${state.activeDetailTab === 'links' ? 'user-tab-btn--active' : ''}" data-detail-tab="links">
              User Links (${links.length})
            </button>
            <button class="user-tab-btn ${state.activeDetailTab === 'logs' ? 'user-tab-btn--active' : ''}" data-detail-tab="logs">
              Access Logs (${logs.length})
            </button>
          </div>

          <div class="user-expanded-body">
            ${isLoading ? `
              <div class="spinner-small"></div>
              <span>Loading details for ${escapeHtml(user.displayName || user.email)}...</span>
            ` : renderDetailTabContent(user)}
          </div>
        </div>
      </td>
    </tr>
  `;
}

/**
 * Renders tab content inside user drawer
 */
function renderDetailTabContent(user) {
  const { notes, links, logs } = state.userDetails;

  if (state.activeDetailTab === 'notes') {
    if (notes.length === 0) {
      return '<p class="text-tertiary">No notes created by this user yet.</p>';
    }
    return `
      <div class="detail-items-list">
        ${notes.map(n => `
          <div class="detail-item">
            <img src="https://img.icons8.com/fluency/20/document.png" alt="" />
            <div class="detail-item__info">
              <span class="detail-item__title">${escapeHtml(n.title || 'Untitled')}</span>
              <span class="detail-item__meta">${escapeHtml(n.subject || 'General')} &bull; ${(n.charCount || n.content?.length || 0).toLocaleString()} chars &bull; ${formatTimestamp(n.updatedAt || n.createdAt)}</span>
            </div>
            ${n.isPublic ? '<span class="badge badge--public">Public</span>' : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  if (state.activeDetailTab === 'links') {
    if (links.length === 0) {
      return '<p class="text-tertiary">No links saved by this user yet.</p>';
    }
    return `
      <div class="detail-items-list">
        ${links.map(l => `
          <div class="detail-item">
            <img src="https://img.icons8.com/fluency/20/link.png" alt="" />
            <div class="detail-item__info">
              <span class="detail-item__title">${escapeHtml(l.title || 'Untitled')}</span>
              <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="detail-item__link">${escapeHtml(truncate(l.url, 45))}</a>
            </div>
            <span class="badge badge--subject">${escapeHtml(l.subject || 'General')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Access Logs
  if (logs.length === 0) {
    return '<p class="text-tertiary">No recorded access logs for this user.</p>';
  }

  return `
    <table class="table table--compact logs-table">
      <thead>
        <tr>
          <th>Action</th>
          <th>Doc Type</th>
          <th>Document ID</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map(log => `
          <tr>
            <td>
              <span class="badge badge--action-${escapeHtml(log.action || 'info')}">
                ${escapeHtml(log.action || 'view')}
              </span>
            </td>
            <td>${escapeHtml(log.documentType || 'note')}</td>
            <td><code>${escapeHtml(log.documentId || '-')}</code></td>
            <td class="text-secondary">${formatTimestamp(log.timestamp)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Attaches table interactions
 */
function bindTableInteractions() {
  const container = state.container;
  if (!container) return;

  // Toggle user details
  container.querySelectorAll('.btn-toggle-details').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.uid;
      if (state.selectedUserId === uid) {
        state.selectedUserId = null;
        renderUserTable();
      } else {
        state.selectedUserId = uid;
        await loadUserDetails(uid);
      }
    });
  });

  // User detail tabs
  container.querySelectorAll('.user-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeDetailTab = btn.dataset.detailTab;
      renderUserTable();
    });
  });

  // Role select dropdown
  container.querySelectorAll('.role-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      e.stopPropagation();
      const uid = select.dataset.uid;
      const newRole = select.value;
      await handleRoleChange(uid, newRole, select);
    });
  });
}

/**
 * Loads user's notes, links, and logs
 */
async function loadUserDetails(uid) {
  state.userDetails.isLoading = true;
  renderUserTable();

  try {
    const [notes, links, logs] = await Promise.all([
      FirestoreService.getUserNotes(uid, {}).catch(err => {
        console.warn('Error fetching user notes:', err);
        return [];
      }),
      FirestoreService.getUserLinks(uid, {}).catch(err => {
        console.warn('Error fetching user links:', err);
        return [];
      }),
      FirestoreService.getAccessLogs({ uid, limit: 15 }).catch(err => {
        console.warn('Error fetching user logs:', err);
        return [];
      })
    ]);

    state.userDetails.notes = notes || [];
    state.userDetails.links = links || [];
    state.userDetails.logs = logs || [];
  } catch (err) {
    console.error('Failed to load user details:', err);
    showToast(`Error loading details: ${err.message}`, 'error');
  } finally {
    state.userDetails.isLoading = false;
    renderUserTable();
  }
}

/**
 * Handles role update
 */
async function handleRoleChange(uid, newRole, selectElement) {
  const user = state.users.find(u => (u.id || u.uid) === uid);
  const userName = user?.displayName || user?.email || uid;

  if (uid === AppState.user?.uid && newRole !== 'admin') {
    if (!confirm('Warning: You are demoting your own account from admin. You may lose access to this admin panel. Continue?')) {
      if (selectElement) selectElement.value = 'admin';
      return;
    }
  }

  try {
    showToast(`Updating role for ${userName}...`, 'info');
    await FirestoreService.updateUserRole(uid, newRole);

    if (user) {
      user.role = newRole;
    }

    showToast(`Role updated to ${newRole}`, 'success');
  } catch (err) {
    console.error('Failed to update user role:', err);
    showToast(`Failed to update role: ${err.message}`, 'error');
    if (user && selectElement) {
      selectElement.value = user.role || 'user';
    }
  }
}

/**
 * Destroy cleanup
 */
export function destroy() {
  state.container = null;
  state.users = [];
  state.selectedUserId = null;
  state.userDetails = { notes: [], links: [], logs: [], isLoading: false };
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

function truncate(str, max = 30) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function getInitials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (email && email.length >= 2) {
    return email.substring(0, 2).toUpperCase();
  }
  return 'U';
}

function formatTimestamp(ts) {
  if (!ts) return 'Never';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);

  if (isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
