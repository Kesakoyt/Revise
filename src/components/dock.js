/**
 * Fiches & Cloud — Left Dock Application Launcher
 * Provides vertical quick-launch access to standard and administrative modules.
 */

import { EventBus, AppState } from '../app.js';

let hostContainer = null;
let currentActiveAppId = null;

let boundOnLogin = null;
let boundOnLogout = null;
let boundOnAppOpen = null;

/**
 * Render the dock within the host aside element
 * @param {HTMLElement} container 
 */
export function render(container) {
  hostContainer = container;

  container.innerHTML = `
    <div class="dock__inner" role="navigation" aria-label="Applications Fiches & Cloud">
      <div class="dock__list">
        <!-- Standard Apps (Available for all authenticated users) -->
        <button type="button" class="dock__icon" data-app-id="file-explorer" title="Explorateur de fiches" aria-label="Explorateur de fiches">
          <img src="https://img.icons8.com/fluency/32/folder.png" alt="Explorateur" width="28" height="28">
          <span class="dock__tooltip">Explorateur</span>
        </button>

        <button type="button" class="dock__icon" data-app-id="link-manager" title="Gestionnaire de liens" aria-label="Gestionnaire de liens">
          <img src="https://img.icons8.com/fluency/32/link.png" alt="Liens" width="28" height="28">
          <span class="dock__tooltip">Liens</span>
        </button>

        <!-- Admin Separator -->
        <div class="dock__separator" id="dock-admin-separator" style="display: none;" role="separator"></div>

        <!-- Admin Apps (Restricted to administrator role) -->
        <div class="dock__admin-section" id="dock-admin-section" style="display: none;">
          <button type="button" class="dock__icon" data-app-id="admin-database" title="Explorateur Base de données" aria-label="Base de données">
            <img src="https://img.icons8.com/fluency/32/database.png" alt="Base de données" width="28" height="28">
            <span class="dock__tooltip">Données</span>
          </button>

          <button type="button" class="dock__icon" data-app-id="admin-users" title="Gestion des Utilisateurs" aria-label="Utilisateurs">
            <img src="https://img.icons8.com/fluency/32/group.png" alt="Utilisateurs" width="28" height="28">
            <span class="dock__tooltip">Utilisateurs</span>
          </button>

          <button type="button" class="dock__icon" data-app-id="admin-statistics" title="Statistiques & Métriques" aria-label="Statistiques">
            <img src="https://img.icons8.com/fluency/32/combo-chart.png" alt="Statistiques" width="28" height="28">
            <span class="dock__tooltip">Statistiques</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach click listeners to all dock icon buttons
  const buttons = container.querySelectorAll('.dock__icon');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const appId = button.getAttribute('data-app-id');
      if (appId) {
        setActiveApp(appId);
        EventBus.emit('app:open', { appId });
      }
    });
  });

  // Evaluate initial admin visibility
  updateAdminVisibility();

  // Setup event listeners
  boundOnLogin = () => {
    updateAdminVisibility();
  };

  boundOnLogout = () => {
    currentActiveAppId = null;
    updateActiveButtons();
    updateAdminVisibility();
  };

  boundOnAppOpen = ({ appId }) => {
    if (appId) {
      setActiveApp(appId);
    }
  };

  EventBus.on('auth:login', boundOnLogin);
  EventBus.on('auth:logout', boundOnLogout);
  EventBus.on('app:open', boundOnAppOpen);
}

/**
 * Show or hide administrator shortcuts based on AppState
 */
function updateAdminVisibility() {
  if (!hostContainer) return;
  const separator = hostContainer.querySelector('#dock-admin-separator');
  const adminSection = hostContainer.querySelector('#dock-admin-section');
  if (!separator || !adminSection) return;

  const isAdmin = Boolean(AppState.isAdmin || AppState.profile?.role === 'admin');
  separator.style.display = isAdmin ? 'block' : 'none';
  adminSection.style.display = isAdmin ? 'flex' : 'none';
}

/**
 * Update visual active state on dock icon buttons
 * @param {string} appId 
 */
function setActiveApp(appId) {
  currentActiveAppId = appId;
  updateActiveButtons();
}

/**
 * Refresh button active CSS modifier
 */
function updateActiveButtons() {
  if (!hostContainer) return;
  const buttons = hostContainer.querySelectorAll('.dock__icon');
  buttons.forEach(btn => {
    const btnAppId = btn.getAttribute('data-app-id');
    btn.classList.toggle('dock__icon--active', btnAppId === currentActiveAppId);
  });
}

/**
 * Destroy component and clear listeners
 */
export function destroy() {
  if (boundOnLogin) EventBus.off('auth:login', boundOnLogin);
  if (boundOnLogout) EventBus.off('auth:logout', boundOnLogout);
  if (boundOnAppOpen) EventBus.off('app:open', boundOnAppOpen);

  boundOnLogin = null;
  boundOnLogout = null;
  boundOnAppOpen = null;

  if (hostContainer) {
    hostContainer.innerHTML = '';
    hostContainer = null;
  }
}
