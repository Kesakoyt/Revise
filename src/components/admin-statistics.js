/**
 * Admin Statistics Component
 * Analytics dashboard displaying system stats, subject distribution bar chart,
 * storage consumption, and recent access activity feed.
 */
import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState } from '../app.js';

// Module state
const state = {
  container: null,
  stats: null,
  recentLogs: [],
  userMap: {},
  autoRefreshInterval: null,
  autoRefreshEnabled: false,
  lastUpdated: null,
  isLoading: false
};

/**
 * Renders Admin Statistics dashboard
 * @param {HTMLElement} container 
 * @param {Object} params 
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('admin-statistics-container');

  // Build skeleton UI
  container.innerHTML = `
    <div class="admin-statistics">
      <!-- Header -->
      <div class="admin-statistics__header">
        <div class="admin-statistics__title-wrap">
          <img src="https://img.icons8.com/fluency/28/combo-chart.png" alt="" />
          <div>
            <h2>Statistics & Analytics</h2>
            <span class="text-tertiary" id="stat-last-updated">Updating metrics...</span>
          </div>
        </div>

        <div class="admin-statistics__actions">
          <label class="auto-refresh-toggle" title="Automatically refresh metrics every 30 seconds">
            <input type="checkbox" id="stat-auto-refresh-check" ${state.autoRefreshEnabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
            <span class="toggle-label">Auto-refresh (30s)</span>
          </label>

          <button class="btn btn--secondary" id="stat-refresh-btn" title="Refresh metrics">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <!-- Main Dashboard Grid -->
      <div class="admin-statistics__content" id="stat-content">
        <div class="admin-statistics__loading">
          <div class="spinner"></div>
          <p>Calculating system analytics...</p>
        </div>
      </div>
    </div>
  `;

  setupControls();
  await loadDashboardData();

  if (state.autoRefreshEnabled) {
    startAutoRefresh();
  }
}

/**
 * Sets up buttons and toggles
 */
function setupControls() {
  const container = state.container;
  if (!container) return;

  const refreshBtn = container.querySelector('#stat-refresh-btn');
  const autoRefreshCheck = container.querySelector('#stat-auto-refresh-check');

  refreshBtn?.addEventListener('click', async () => {
    await loadDashboardData();
  });

  autoRefreshCheck?.addEventListener('change', (e) => {
    state.autoRefreshEnabled = e.target.checked;
    if (state.autoRefreshEnabled) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
}

/**
 * Starts auto-refresh interval (30s)
 */
function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshInterval = setInterval(async () => {
    if (state.container) {
      await loadDashboardData(true);
    }
  }, 30000);
}

/**
 * Stops auto-refresh
 */
function stopAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
  }
}

/**
 * Fetches stats, logs, and users from FirestoreService
 * @param {boolean} silent 
 */
async function loadDashboardData(silent = false) {
  const container = state.container;
  const content = container?.querySelector('#stat-content');
  if (!content) return;

  if (!silent) {
    state.isLoading = true;
    content.innerHTML = `
      <div class="admin-statistics__loading">
        <div class="spinner"></div>
        <p>Calculating system analytics...</p>
      </div>
    `;
  }

  try {
    const [stats, logs, users] = await Promise.all([
      FirestoreService.getStats().catch(err => {
        console.warn('Failed to getStats:', err);
        return { totalNotes: 0, totalLinks: 0, totalChars: 0, activeUsers: 0, subjectBreakdown: {} };
      }),
      FirestoreService.getAccessLogs({ limit: 20 }).catch(err => {
        console.warn('Failed to getAccessLogs:', err);
        return [];
      }),
      FirestoreService.getAllUsers().catch(err => {
        console.warn('Failed to getAllUsers:', err);
        return [];
      })
    ]);

    state.stats = stats;
    state.recentLogs = logs || [];

    // Map uid to name for logs
    state.userMap = {};
    (users || []).forEach(u => {
      state.userMap[u.id || u.uid] = u.displayName || u.email || 'User ' + (u.id || u.uid).substring(0, 5);
    });

    state.lastUpdated = new Date();
    updateTimestampDisplay();
    renderDashboard();
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    content.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Failed to load statistics</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
      </div>
    `;
  } finally {
    state.isLoading = false;
  }
}

/**
 * Updates last updated text
 */
function updateTimestampDisplay() {
  const updatedEl = state.container?.querySelector('#stat-last-updated');
  if (updatedEl && state.lastUpdated) {
    updatedEl.textContent = `Last updated: ${state.lastUpdated.toLocaleTimeString()}`;
  }
}

/**
 * Renders the full dashboard view
 */
function renderDashboard() {
  const container = state.container;
  const content = container?.querySelector('#stat-content');
  if (!content || !state.stats) return;

  const { totalNotes = 0, totalLinks = 0, totalChars = 0, activeUsers = 0, subjectBreakdown = {} } = state.stats;

  // Formatting values
  const formattedChars = totalChars >= 1000000 
    ? (totalChars / 1000000).toFixed(2) + ' M' 
    : totalChars.toLocaleString();

  const avgCharsPerNote = totalNotes > 0 ? Math.round(totalChars / totalNotes) : 0;
  const avgNotesPerUser = activeUsers > 0 ? (totalNotes / activeUsers).toFixed(1) : 0;

  // Build HTML
  content.innerHTML = `
    <!-- Top Row Stat Cards Grid -->
    <div class="stats-grid">
      <div class="card stat-card">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--notes">
          <img src="https://img.icons8.com/fluency/36/document.png" alt="" />
        </div>
        <div class="stat-card__info">
          <span class="stat-card__label">Total Notes</span>
          <h3 class="stat-card__value">${totalNotes.toLocaleString()}</h3>
          <span class="stat-card__sub">${avgNotesPerUser} notes / user avg</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--links">
          <img src="https://img.icons8.com/fluency/36/link.png" alt="" />
        </div>
        <div class="stat-card__info">
          <span class="stat-card__label">Total Links</span>
          <h3 class="stat-card__value">${totalLinks.toLocaleString()}</h3>
          <span class="stat-card__sub">Curated references</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--storage">
          <img src="https://img.icons8.com/fluency/36/database.png" alt="" />
        </div>
        <div class="stat-card__info">
          <span class="stat-card__label">Total Characters</span>
          <h3 class="stat-card__value">${formattedChars}</h3>
          <span class="stat-card__sub">${avgCharsPerNote.toLocaleString()} chars / note avg</span>
        </div>
      </div>

      <div class="card stat-card">
        <div class="stat-card__icon-wrap stat-card__icon-wrap--users">
          <img src="https://img.icons8.com/fluency/36/group.png" alt="" />
        </div>
        <div class="stat-card__info">
          <span class="stat-card__label">Active Users</span>
          <h3 class="stat-card__value">${activeUsers.toLocaleString()}</h3>
          <span class="stat-card__sub">Registered accounts</span>
        </div>
      </div>
    </div>

    <!-- Storage Section -->
    <div class="card stat-section">
      <div class="stat-section__header">
        <div class="stat-section__title-wrap">
          <img src="https://img.icons8.com/fluency/20/database.png" alt="" />
          <h4>Storage & Character Pool</h4>
        </div>
        <span class="text-secondary">${totalChars.toLocaleString()} characters stored</span>
      </div>
      <div class="stat-storage-meter">
        <div class="stat-storage-meter__track">
          <!-- Benchmark storage capacity: 10,000,000 characters benchmark -->
          <div class="stat-storage-meter__fill" style="width: ${Math.min(100, Math.max(3, (totalChars / 10000000) * 100))}%"></div>
        </div>
        <div class="stat-storage-meter__meta">
          <span>0 chars</span>
          <span>${Math.round((totalChars / 10000000) * 100)}% of 10M tier benchmark</span>
          <span>10,000,000 chars</span>
        </div>
      </div>
    </div>

    <!-- 2 Column Section: Subject Breakdown & Recent Activity -->
    <div class="stats-two-col">
      <!-- Subject Breakdown Chart -->
      <div class="card stat-section">
        <div class="stat-section__header">
          <div class="stat-section__title-wrap">
            <img src="https://img.icons8.com/fluency/20/combo-chart.png" alt="" />
            <h4>Subject Breakdown</h4>
          </div>
          <span class="text-secondary">${Object.keys(subjectBreakdown).length} subjects</span>
        </div>
        <div class="stat-subject-chart" id="stat-subject-chart">
          ${renderSubjectBars(subjectBreakdown, totalNotes)}
        </div>
      </div>

      <!-- Recent Activity Feed -->
      <div class="card stat-section">
        <div class="stat-section__header">
          <div class="stat-section__title-wrap">
            <img src="https://img.icons8.com/fluency/20/clock.png" alt="" />
            <h4>Recent Activity</h4>
          </div>
          <span class="text-secondary">Last 20 events</span>
        </div>
        <div class="stat-activity-table-wrap">
          ${renderActivityTable(state.recentLogs)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Generates horizontal CSS-only bar chart for subject breakdown
 */
function renderSubjectBars(breakdown, totalNotes) {
  const entries = Object.entries(breakdown || {});

  if (entries.length === 0) {
    return `
      <div class="empty-state empty-state--compact">
        <p class="empty-state__title">No subject data</p>
        <p class="empty-state__description">Create notes with subjects to view distribution.</p>
      </div>
    `;
  }

  // Sort descending by count
  entries.sort((a, b) => b[1] - a[1]);

  // Max count for proportional widths
  const maxVal = Math.max(...entries.map(e => e[1])) || 1;

  // Preset palette for bars
  const colors = [
    'linear-gradient(90deg, #0078d4, #00bcf2)',
    'linear-gradient(90deg, #107c41, #27ae60)',
    'linear-gradient(90deg, #8764b8, #b146c2)',
    'linear-gradient(90deg, #d83b01, #ea4335)',
    'linear-gradient(90deg, #008272, #00a88f)',
    'linear-gradient(90deg, #ff8c00, #ffb900)'
  ];

  let html = '<div class="subject-bars-list">';
  entries.forEach(([subject, count], index) => {
    const widthPct = Math.round((count / maxVal) * 100);
    const totalPct = totalNotes > 0 ? Math.round((count / totalNotes) * 100) : 0;
    const bgGradient = colors[index % colors.length];

    html += `
      <div class="subject-bar-row">
        <div class="subject-bar-header">
          <span class="subject-bar-name" title="${escapeHtml(subject)}">${escapeHtml(subject)}</span>
          <span class="subject-bar-count">${count} ${count === 1 ? 'note' : 'notes'} (${totalPct}%)</span>
        </div>
        <div class="subject-bar-track">
          <div class="subject-bar-fill" style="width: ${widthPct}%; background: ${bgGradient};"></div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  return html;
}

/**
 * Generates recent access activity log table
 */
function renderActivityTable(logs) {
  if (!logs || logs.length === 0) {
    return `
      <div class="empty-state empty-state--compact">
        <p class="empty-state__title">No activity logs recorded</p>
        <p class="empty-state__description">User actions will be logged here.</p>
      </div>
    `;
  }

  let html = `
    <div class="table-responsive">
      <table class="table table--compact activity-table">
        <thead>
          <tr class="table__header">
            <th>User</th>
            <th>Action</th>
            <th>Document</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
  `;

  logs.forEach(log => {
    const userName = escapeHtml(state.userMap[log.uid] || log.uid || 'Anonymous');
    const action = log.action || 'view';
    const docType = log.documentType || 'note';
    const docId = log.documentId ? truncate(log.documentId, 12) : '-';
    const timeAgoStr = timeAgo(log.timestamp);

    html += `
      <tr class="table__row">
        <td class="table__cell font-semibold" title="${userName}">${truncate(userName, 18)}</td>
        <td class="table__cell">
          <span class="badge badge--action-${escapeHtml(action)}">
            ${escapeHtml(action)}
          </span>
        </td>
        <td class="table__cell">
          <span class="text-secondary">${escapeHtml(docType)}:</span> <code>${escapeHtml(docId)}</code>
        </td>
        <td class="table__cell text-secondary" title="${formatExactDate(log.timestamp)}">${timeAgoStr}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  return html;
}

/**
 * Clean destruction
 */
export function destroy() {
  stopAutoRefresh();
  state.container = null;
  state.stats = null;
  state.recentLogs = [];
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

function truncate(str, max = 20) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function timeAgo(ts) {
  if (!ts) return 'Unknown';
  let date;
  if (ts.toDate) date = ts.toDate();
  else if (ts.seconds) date = new Date(ts.seconds * 1000);
  else date = new Date(ts);

  if (isNaN(date.getTime())) return 'Recently';

  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 45) return 'Just now';
  if (diffSec < 90) return '1 min ago';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mins ago`;
  if (diffSec < 7200) return '1 hour ago';
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
  if (diffSec < 172800) return 'Yesterday';
  return `${Math.floor(diffSec / 86400)} days ago`;
}

function formatExactDate(ts) {
  if (!ts) return '';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}
