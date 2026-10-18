/**
 * Fiches & Cloud — top navigation bar.
 *
 * Left  : brand.
 * Centre: user-configurable shortcut bar (backed by the `shortcuts` collection).
 * Right : theme toggle, user name + role badge, sign-out.
 */

import { EventBus, AppState, showToast, showModal, iconImg } from '../app.js';
import { AuthService, DEFAULT_SHORTCUTS } from '../services/auth-service.js';
import { FirestoreService } from '../services/firestore-service.js';

let host = null;
let shortcuts = [];
const bound = {};

/** Icons offered when creating a shortcut. */
const ICON_CHOICES = [
  'opened-folder', 'document', 'link', 'database', 'group', 'combo-chart',
  'star', 'bookmark', 'search', 'clock', 'settings', 'key'
];

/** In-app destinations offered when creating a shortcut. */
const ACTION_CHOICES = [
  { value: 'file-explorer', label: 'Fichiers & dossiers' },
  { value: 'markdown-editor', label: 'Éditeur Markdown' },
  { value: 'user-profile', label: 'Mon profil' },
  { value: '__url__', label: 'Adresse web (URL)…' }
];

/** Legacy values kept working after apps / icons were renamed or removed. */
const ACTION_ALIASES = { 'link-manager': 'file-explorer' };
const ICON_ALIASES = { folder: 'opened-folder', grid: 'thumbnails', logout: 'logout-rounded' };

/** @param {HTMLElement} container */
export function render(container) {
  host = container;
  container.innerHTML = `
    <div class="navbar__inner">
      <div class="navbar__brand" title="Fiches & Cloud">
        ${iconImg('cloud-checked', { size: 28, alt: 'Fiches & Cloud', className: 'navbar__brand-icon' })}
        <span class="navbar__brand-text">Fiches &amp; Cloud</span>
      </div>

      <nav class="navbar__shortcuts" id="navbar-shortcuts" aria-label="Raccourcis rapides"></nav>

      <div class="navbar__actions">
        <button type="button" class="navbar__icon-btn" id="navbar-add-shortcut" title="Ajouter un raccourci" aria-label="Ajouter un raccourci">
          ${iconImg('add', { size: 20, alt: '' })}
        </button>
        <button type="button" class="navbar__icon-btn" id="navbar-theme-btn" title="Changer de thème" aria-label="Changer de thème">
          ${iconImg(AppState.theme === 'dark' ? 'sun' : 'moon', { size: 20, alt: '', className: 'navbar__theme-icon' })}
        </button>
        <div class="navbar__user" id="navbar-user" hidden>
          <button type="button" class="navbar__profile-btn" id="navbar-profile-btn" title="Mon profil" aria-label="Ouvrir mon profil">
            <span class="navbar__avatar" id="navbar-user-avatar"></span>
            <span class="navbar__user-name" id="navbar-user-name"></span>
            <span class="badge badge--user" id="navbar-user-role"></span>
          </button>
          <button type="button" class="navbar__icon-btn navbar__logout-btn" id="navbar-logout-btn" title="Déconnexion" aria-label="Se déconnecter">
            ${iconImg('logout-rounded', { size: 20, alt: '' })}
          </button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#navbar-add-shortcut')?.addEventListener('click', () => openShortcutDialog());
  container.querySelector('#navbar-theme-btn')?.addEventListener('click', toggleTheme);
  container.querySelector('#navbar-logout-btn')?.addEventListener('click', handleLogout);
  container.querySelector('#navbar-profile-btn')?.addEventListener('click', () => {
    if (!AppState.user) return;
    EventBus.emit('app:open', { appId: 'user-profile' });
  });

  renderUser();
  loadShortcuts();

  bound.onLogin = () => { renderUser(); loadShortcuts(); };
  bound.onLogout = () => { shortcuts = []; renderShortcuts(); renderUser(); };
  bound.onProfileUpdated = () => renderUser();
  bound.onTheme = ({ theme }) => {
    const icon = host?.querySelector('.navbar__theme-icon');
    if (icon) icon.src = iconUrlForTheme(theme);
  };

  EventBus.on('auth:login', bound.onLogin);
  EventBus.on('auth:logout', bound.onLogout);
  EventBus.on('profile:updated', bound.onProfileUpdated);
  EventBus.on('theme:changed', bound.onTheme);
}

function iconUrlForTheme(theme) {
  return `https://img.icons8.com/fluency/200/${theme === 'dark' ? 'sun' : 'moon'}.png`;
}

/** Load the signed-in user's shortcuts (falls back to defaults). */
async function loadShortcuts() {
  const uid = AppState.user?.uid;
  if (!uid) { shortcuts = []; renderShortcuts(); return; }

  try {
    const fetched = await FirestoreService.getUserShortcuts(uid);
    shortcuts = fetched.length > 0 ? fetched : DEFAULT_SHORTCUTS.map((s, i) => ({ id: `default-${i}`, ...s }));
  } catch (err) {
    console.warn('[Navbar] shortcuts unavailable, using defaults:', err);
    shortcuts = DEFAULT_SHORTCUTS.map((s, i) => ({ id: `default-${i}`, ...s }));
  }
  renderShortcuts();
}

/** Render the shortcut buttons. */
function renderShortcuts() {
  const bar = host?.querySelector('#navbar-shortcuts');
  if (!bar) return;

  if (!AppState.user || shortcuts.length === 0) {
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = shortcuts.map(sc => `
    <button type="button" class="navbar__shortcut" data-action="${escapeAttr(resolveAction(sc.action))}" title="${escapeAttr(sc.label)}">
      ${iconImg(resolveIcon(sc.icon), { size: 18, alt: '', className: 'navbar__shortcut-icon' })}
      <span class="navbar__shortcut-label">${escapeHtml(sc.label)}</span>
    </button>
  `).join('');

  bar.querySelectorAll('.navbar__shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action || '';
      if (/^https?:\/\//i.test(action)) {
        window.open(action, '_blank', 'noopener,noreferrer');
      } else if (action) {
        EventBus.emit('app:open', { appId: action });
      }
    });
  });
}

/** Render the user identity block. */
function renderUser() {
  const wrap = host?.querySelector('#navbar-user');
  const nameEl = host?.querySelector('#navbar-user-name');
  const roleEl = host?.querySelector('#navbar-user-role');
  const avatarEl = host?.querySelector('#navbar-user-avatar');
  if (!wrap || !nameEl || !roleEl) return;

  if (!AppState.user) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  const name = AppState.profile?.displayName
    || AppState.user.displayName
    || AppState.user.email
    || 'Utilisateur';
  nameEl.textContent = name;

  if (avatarEl) {
    avatarEl.textContent = String(name).trim().charAt(0).toUpperCase() || '?';
    avatarEl.style.background = AppState.profile?.avatarColor || '#0078d4';
  }

  const admin = Boolean(AppState.isAdmin || AppState.profile?.role === 'admin');
  roleEl.textContent = admin ? 'Admin' : 'Étudiant';
  roleEl.className = `badge ${admin ? 'badge--admin' : 'badge--user'}`;
}

/** Toggle light/dark theme. */
function toggleTheme() {
  const next = (AppState.theme || 'light') === 'dark' ? 'light' : 'dark';
  AppState.theme = next;
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('fiches_theme', next);

  const icon = host?.querySelector('.navbar__theme-icon');
  if (icon) icon.src = iconUrlForTheme(next);
  EventBus.emit('theme:changed', { theme: next });
}

/** Sign the user out. */
async function handleLogout() {
  try {
    await AuthService.signOut();
    showToast('Vous avez été déconnecté.', 'info');
  } catch (err) {
    console.error('[Navbar] sign-out failed:', err);
    showToast('Erreur lors de la déconnexion.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Shortcut creation dialog
// ---------------------------------------------------------------------------

/** Open the "add shortcut" modal. */
function openShortcutDialog() {
  if (!AppState.user) {
    showToast('Connectez-vous pour personnaliser vos raccourcis.', 'info');
    return;
  }

  const form = document.createElement('div');
  form.className = 'shortcut-modal';
  form.innerHTML = `
    <h3 class="shortcut-modal__title">Ajouter un raccourci</h3>
    <form id="shortcut-form" class="login-form" novalidate>
      <div class="login-form__field">
        <label class="login-form__label" for="sc-label">Libellé</label>
        <input class="input" id="sc-label" type="text" placeholder="Ex : Ma matière" maxlength="24" required>
      </div>
      <div class="login-form__field">
        <label class="login-form__label" for="sc-icon">Icône</label>
        <select class="input select" id="sc-icon">
          ${ICON_CHOICES.map(n => `<option value="${n}">${n}</option>`).join('')}
        </select>
      </div>
      <div class="login-form__field">
        <label class="login-form__label" for="sc-target">Destination</label>
        <select class="input select" id="sc-target">
          ${ACTION_CHOICES.map(a => `<option value="${a.value}">${a.label}</option>`).join('')}
        </select>
      </div>
      <div class="login-form__field" id="sc-url-field" hidden>
        <label class="login-form__label" for="sc-url">Adresse web</label>
        <input class="input" id="sc-url" type="url" placeholder="https://exemple.fr">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--secondary" id="sc-cancel">Annuler</button>
        <button type="submit" class="btn btn--primary">Ajouter</button>
      </div>
    </form>
  `;

  const targetSelect = form.querySelector('#sc-target');
  const urlField = form.querySelector('#sc-url-field');
  targetSelect.addEventListener('change', () => {
    urlField.hidden = targetSelect.value !== '__url__';
  });

  const modal = showModal(form, { dismissible: true });
  form.querySelector('#sc-cancel')?.addEventListener('click', () => modal.hide());

  form.querySelector('#shortcut-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const label = form.querySelector('#sc-label').value.trim();
    const icon = form.querySelector('#sc-icon').value;
    const target = targetSelect.value;
    const action = target === '__url__' ? form.querySelector('#sc-url').value.trim() : target;

    if (!label) return showToast('Indiquez un libellé.', 'error');
    if (!action) return showToast('Indiquez une destination.', 'error');

    try {
      const id = await FirestoreService.createShortcut({
        uid: AppState.user.uid,
        label,
        icon,
        action,
        order: shortcuts.length
      });
      shortcuts = [...shortcuts, { id, label, icon, action, order: shortcuts.length }];
      renderShortcuts();
      showToast('Raccourci ajouté.', 'success');
      modal.hide();
    } catch (err) {
      console.error('[Navbar] shortcut creation failed:', err);
      showToast(`Échec de l'ajout : ${err.message}`, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function resolveAction(action) { return ACTION_ALIASES[action] || action; }
function resolveIcon(name) { return ICON_ALIASES[name] || name; }

function escapeAttr(str) {
  return escapeHtml(str);
}

/** Tear down the navbar. */
export function destroy() {
  EventBus.off('auth:login', bound.onLogin);
  EventBus.off('auth:logout', bound.onLogout);
  EventBus.off('profile:updated', bound.onProfileUpdated);
  EventBus.off('theme:changed', bound.onTheme);
  shortcuts = [];
  if (host) { host.innerHTML = ''; host = null; }
}
