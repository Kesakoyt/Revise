/**
 * Fiches & Cloud — Top Navigation Bar Component
 * Displays branding, quick-action shortcuts, theme toggle, and authenticated user details.
 */

import { EventBus, AppState, showToast } from '../app.js';
import { AuthService } from '../services/auth-service.js';

let hostContainer = null;
let boundOnLogin = null;
let boundOnLogout = null;
let boundOnThemeChanged = null;

// Default shortcuts when profile has none configured
const DEFAULT_SHORTCUTS = [
  { icon: 'folder', label: 'Fiches', action: 'file-explorer' },
  { icon: 'add', label: 'Nouvelle Fiche', action: 'markdown-editor' },
  { icon: 'link', label: 'Liens', action: 'link-manager' }
];

/**
 * Render the navbar inside the specified host element
 * @param {HTMLElement} container 
 */
export function render(container) {
  hostContainer = container;
  container.innerHTML = `
    <div class="navbar__inner">
      <!-- Left: Logo & Brand -->
      <div class="navbar__logo" role="banner">
        <img src="https://img.icons8.com/fluency/28/cloud-checked.png" alt="Fiches & Cloud Logo" class="navbar__logo-icon" width="28" height="28">
        <span class="navbar__logo-text">Fiches & Cloud</span>
      </div>

      <!-- Center: Shortcut Bar -->
      <nav class="navbar__shortcuts" id="navbar-shortcuts" aria-label="Raccourcis rapides">
        <!-- Rendered dynamically -->
      </nav>

      <!-- Right: Actions & User Profile -->
      <div class="navbar__actions">
        <!-- Theme Toggle -->
        <button type="button" class="btn btn--icon navbar__theme-toggle" id="theme-toggle-btn" title="Changer le thème (Sombre/Clair)" aria-label="Changer le thème">
          <img src="https://img.icons8.com/fluency/24/${AppState.theme === 'dark' ? 'sun' : 'moon'}.png" alt="Thème" id="theme-toggle-icon" width="20" height="20">
        </button>

        <!-- User Information & Logout -->
        <div class="navbar__user" id="navbar-user-info" style="${AppState.user ? 'display:flex;' : 'display:none;'}">
          <span class="navbar__user-name" id="navbar-user-name"></span>
          <span class="badge" id="navbar-user-role"></span>
          <button type="button" class="btn btn--icon navbar__logout-btn" id="navbar-logout-btn" title="Déconnexion" aria-label="Se déconnecter">
            <img src="https://img.icons8.com/fluency/24/logout.png" alt="Déconnexion" width="20" height="20">
          </button>
        </div>
      </div>
    </div>
  `;

  // Bind Theme Toggle Click
  const themeBtn = container.querySelector('#theme-toggle-btn');
  themeBtn?.addEventListener('click', toggleTheme);

  // Bind Logout Button Click
  const logoutBtn = container.querySelector('#navbar-logout-btn');
  logoutBtn?.addEventListener('click', handleLogout);

  // Initial populate of shortcuts and user info
  renderShortcuts();
  renderUserInfo();

  // Setup EventBus Listeners
  boundOnLogin = () => {
    renderShortcuts();
    renderUserInfo();
  };

  boundOnLogout = () => {
    renderShortcuts();
    renderUserInfo();
  };

  boundOnThemeChanged = ({ theme }) => {
    updateThemeIcon(theme);
  };

  EventBus.on('auth:login', boundOnLogin);
  EventBus.on('auth:logout', boundOnLogout);
  EventBus.on('theme:changed', boundOnThemeChanged);
}

/**
 * Render user profile shortcuts in the center bar
 */
function renderShortcuts() {
  if (!hostContainer) return;
  const shortcutsContainer = hostContainer.querySelector('#navbar-shortcuts');
  if (!shortcutsContainer) return;

  const shortcuts = (AppState.profile?.shortcuts && AppState.profile.shortcuts.length > 0)
    ? AppState.profile.shortcuts
    : DEFAULT_SHORTCUTS;

  shortcutsContainer.innerHTML = shortcuts.map(sc => `
    <button type="button" class="btn btn--secondary navbar__shortcut-item" data-action="${sc.action}" title="${sc.label}">
      <img src="https://img.icons8.com/fluency/20/${sc.icon || 'document'}.png" alt="" class="navbar__shortcut-icon" width="18" height="18">
      <span class="navbar__shortcut-label">${sc.label}</span>
    </button>
  `).join('');

  shortcutsContainer.querySelectorAll('.navbar__shortcut-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (!action) return;

      if (action.startsWith('http://') || action.startsWith('https://')) {
        window.open(action, '_blank', 'noopener,noreferrer');
      } else {
        EventBus.emit('app:open', { appId: action });
      }
    });
  });
}

/**
 * Render display name and role badge
 */
function renderUserInfo() {
  if (!hostContainer) return;
  const userSection = hostContainer.querySelector('#navbar-user-info');
  const nameEl = hostContainer.querySelector('#navbar-user-name');
  const roleEl = hostContainer.querySelector('#navbar-user-role');
  if (!userSection || !nameEl || !roleEl) return;

  if (AppState.user) {
    userSection.style.display = 'flex';
    const displayName = AppState.profile?.displayName || AppState.user.displayName || AppState.user.email || 'Utilisateur';
    nameEl.textContent = displayName;

    const isAdmin = AppState.isAdmin || AppState.profile?.role === 'admin';
    roleEl.textContent = isAdmin ? 'Admin' : 'Étudiant';
    roleEl.className = `badge ${isAdmin ? 'badge--admin' : 'badge--user'}`;
  } else {
    userSection.style.display = 'none';
    nameEl.textContent = '';
    roleEl.textContent = '';
  }
}

/**
 * Switch between light and dark themes
 */
function toggleTheme() {
  const currentTheme = AppState.theme || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  AppState.theme = newTheme;
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('fiches_theme', newTheme);
  localStorage.setItem('theme', newTheme);

  EventBus.emit('theme:changed', { theme: newTheme });
  updateThemeIcon(newTheme);
}

/**
 * Update the theme toggle button icon
 * @param {'light'|'dark'} theme 
 */
function updateThemeIcon(theme) {
  if (!hostContainer) return;
  const icon = hostContainer.querySelector('#theme-toggle-icon');
  if (icon) {
    icon.src = `https://img.icons8.com/fluency/24/${theme === 'dark' ? 'sun' : 'moon'}.png`;
  }
}

/**
 * Handle user sign-out request
 */
async function handleLogout() {
  try {
    await AuthService.signOut();
    showToast('Vous avez été déconnecté.', 'info');
  } catch (err) {
    console.error('[Navbar] Sign out error:', err);
    showToast('Erreur lors de la déconnexion.', 'error');
  }
}

/**
 * Cleanup navbar event listeners and DOM
 */
export function destroy() {
  if (boundOnLogin) EventBus.off('auth:login', boundOnLogin);
  if (boundOnLogout) EventBus.off('auth:logout', boundOnLogout);
  if (boundOnThemeChanged) EventBus.off('theme:changed', boundOnThemeChanged);

  boundOnLogin = null;
  boundOnLogout = null;
  boundOnThemeChanged = null;

  if (hostContainer) {
    hostContainer.innerHTML = '';
    hostContainer = null;
  }
}
