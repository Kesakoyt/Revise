/**
 * Fiches & Cloud — left dock (application launcher).
 *
 * Standard apps are always visible; the admin trio is revealed only for users
 * with the `admin` role.
 */

import { EventBus, AppState, iconImg } from '../app.js';

let host = null;
let activeAppId = null;
const bound = {};

const STANDARD_APPS = [
  { id: 'file-explorer', icon: 'opened-folder', label: 'Explorateur', title: 'Fichiers & dossiers' }
];

const ADMIN_APPS = [
  { id: 'admin-database', icon: 'database', label: 'Données', title: 'Base de données' },
  { id: 'admin-users', icon: 'group', label: 'Utilisateurs', title: 'Gestion des utilisateurs' },
  { id: 'admin-shares', icon: 'share', label: 'Partages', title: 'Partages de dossiers' },
  { id: 'admin-statistics', icon: 'combo-chart', label: 'Statistiques', title: 'Statistiques & métriques' }
];

/** @param {HTMLElement} container */
export function render(container) {
  host = container;

  const appButton = app => `
    <button type="button" class="dock__item" data-app-id="${app.id}" title="${app.title}" aria-label="${app.title}">
      ${iconImg(app.icon, { size: 28, alt: '', className: 'dock__item-icon' })}
      <span class="dock__tooltip">${app.label}</span>
    </button>`;

  container.innerHTML = `
    <div class="dock__inner" role="navigation" aria-label="Applications">
      <div class="dock__list">
        ${STANDARD_APPS.map(appButton).join('')}

        <div class="dock__separator" id="dock-admin-separator" role="separator" hidden></div>
        <div class="dock__group" id="dock-admin-group" hidden>
          ${ADMIN_APPS.map(appButton).join('')}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.dock__item').forEach(btn => {
    btn.addEventListener('click', () => {
      const appId = btn.dataset.appId;
      if (appId) EventBus.emit('app:open', { appId });
    });
  });

  updateAdminVisibility();
  updateActive();

  bound.onLogin = updateAdminVisibility;
  bound.onLogout = () => { activeAppId = null; updateActive(); updateAdminVisibility(); };
  bound.onAppOpen = ({ appId }) => { activeAppId = appId; updateActive(); };
  bound.onAppFocus = ({ appId }) => { activeAppId = appId; updateActive(); };

  EventBus.on('auth:login', bound.onLogin);
  EventBus.on('auth:logout', bound.onLogout);
  EventBus.on('app:open', bound.onAppOpen);
  EventBus.on('app:focus', bound.onAppFocus);
}

/** Show/hide the admin section. */
function updateAdminVisibility() {
  const separator = host?.querySelector('#dock-admin-separator');
  const group = host?.querySelector('#dock-admin-group');
  if (!separator || !group) return;

  const admin = Boolean(AppState.isAdmin || AppState.profile?.role === 'admin');
  separator.hidden = !admin;
  group.hidden = !admin;
}

/** Refresh the active-item highlight. */
function updateActive() {
  host?.querySelectorAll('.dock__item').forEach(btn => {
    btn.classList.toggle('dock__item--active', btn.dataset.appId === activeAppId);
  });
}

/** Tear down the dock. */
export function destroy() {
  EventBus.off('auth:login', bound.onLogin);
  EventBus.off('auth:logout', bound.onLogout);
  EventBus.off('app:open', bound.onAppOpen);
  EventBus.off('app:focus', bound.onAppFocus);
  if (host) { host.innerHTML = ''; host = null; }
}
