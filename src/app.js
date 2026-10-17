/**
 * Fiches & Cloud — application entry point.
 *
 * Owns the cross-cutting primitives every component relies on:
 *   • EventBus      — tiny publish/subscribe bus
 *   • AppState      — reactive-ish global state (user, profile, theme)
 *   • iconUrl()     — single source for the mandated Icons8 Fluency URL
 *   • showToast()   — transient notifications
 *   • showModal()   — modal dialogs
 *   • the login/sign-up modal
 *   • the DOMContentLoaded bootstrap sequence
 */

import { AuthService } from './services/auth-service.js';
import { isConfigured } from './services/firebase-config.js';

// ============================================================================
// Icons — the ONLY icon URL pattern used anywhere in the app.
// ============================================================================

/**
 * Build an Icons8 Fluency icon URL.
 * Every icon in the interface is requested at 200px and scaled down in CSS.
 * @param {string} name  Icons8 slug, e.g. "folder", "database", "combo-chart"
 * @returns {string}
 */
export function iconUrl(name) {
  const slug = String(name || 'document').trim() || 'document';
  return `https://img.icons8.com/fluency/200/${slug}.png`;
}

/**
 * Build an <img> tag for an icon.
 * @param {string} name
 * @param {{size?:number, alt?:string, className?:string}} [opts]
 * @returns {string}
 */
export function iconImg(name, { size = 20, alt = '', className = '' } = {}) {
  const cls = className ? ` class="${className}"` : '';
  return `<img src="${iconUrl(name)}" alt="${alt}" width="${size}" height="${size}"${cls} loading="lazy">`;
}

// ============================================================================
// EventBus
// ============================================================================

export const EventBus = {
  _events: {},

  /** Subscribe. @param {string} event @param {Function} cb */
  on(event, cb) {
    (this._events[event] ||= []).push(cb);
  },

  /** Unsubscribe. @param {string} event @param {Function} cb */
  off(event, cb) {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter(fn => fn !== cb);
  },

  /** Publish. @param {string} event @param {*} data */
  emit(event, data) {
    const listeners = this._events[event];
    if (!listeners) return;
    [...listeners].forEach(fn => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] listener error for "${event}":`, err);
      }
    });
  }
};

// ============================================================================
// Global state
// ============================================================================

export const AppState = {
  user: null,      // firebase.User | null
  profile: null,   // Firestore users/{uid} document | null
  theme: 'light',  // 'light' | 'dark'
  isAdmin: false
};

// ============================================================================
// Toasts
// ============================================================================

/**
 * Show a transient toast.
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} [type='info']
 * @param {number} [duration=3500] ms before auto-dismiss (0 = sticky)
 * @returns {HTMLElement|null}
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return null;

  const iconName = { info: 'info', success: 'ok', error: 'cancel', warning: 'high-priority' }[type] || 'info';

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    ${iconImg(iconName, { size: 20, alt: '', className: 'toast__icon' })}
    <span class="toast__message"></span>
    <button type="button" class="toast__close" aria-label="Fermer la notification">&times;</button>
  `;
  // Set text via textContent so message content can never inject markup.
  toast.querySelector('.toast__message').textContent = message;

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.classList.add('toast--hiding');
    setTimeout(() => toast.remove(), 280);
  };

  toast.querySelector('.toast__close')?.addEventListener('click', remove);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  if (duration > 0) setTimeout(remove, duration);
  return toast;
}

// ============================================================================
// Modal
// ============================================================================

let escHandler = null;

/**
 * Open a modal dialog.
 * @param {string|HTMLElement} content
 * @param {{dismissible?:boolean, onClose?:Function}} [options]
 * @returns {{ modalElement: HTMLElement|null, hide: Function }}
 */
export function showModal(content, options = {}) {
  const { dismissible = true, onClose = null } = options;
  const container = document.getElementById('modal-container');
  if (!container) return { modalElement: null, hide: () => {} };

  hideModal();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const overlay = document.createElement('div');
  overlay.className = 'modal__overlay';

  const body = document.createElement('div');
  body.className = 'modal__content';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content instanceof HTMLElement) body.appendChild(content);

  modal.append(overlay, body);
  container.appendChild(modal);

  const close = () => {
    if (modal.classList.contains('modal--hiding')) return;
    modal.classList.add('modal--hiding');
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    setTimeout(() => {
      modal.remove();
      if (typeof onClose === 'function') onClose();
    }, 200);
  };

  if (dismissible) {
    overlay.addEventListener('click', close);
    escHandler = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }

  requestAnimationFrame(() => modal.classList.add('modal--visible'));
  return { modalElement: modal, hide: close };
}

/** Close any open modal. */
export function hideModal() {
  const container = document.getElementById('modal-container');
  if (!container) return;
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  container.querySelectorAll('.modal').forEach(m => {
    m.classList.add('modal--hiding');
    setTimeout(() => m.remove(), 200);
  });
}

// ============================================================================
// Login / sign-up modal
// ============================================================================

const AUTH_ERRORS = {
  'auth/user-not-found': 'Identifiants incorrects. Vérifiez votre email et votre mot de passe.',
  'auth/wrong-password': 'Identifiants incorrects. Vérifiez votre email et votre mot de passe.',
  'auth/invalid-credential': 'Identifiants incorrects. Vérifiez votre email et votre mot de passe.',
  'auth/email-already-in-use': 'Cette adresse email est déjà associée à un compte.',
  'auth/weak-password': 'Le mot de passe doit comporter au moins 6 caractères.',
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/network-request-failed': 'Connexion réseau impossible. Vérifiez votre connexion.',
  'auth/operation-not-allowed': "La connexion email/mot de passe n'est pas activée dans la console Firebase."
};

/** Render the non-dismissible authentication modal. */
function renderAuthModal() {
  let signUpMode = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'login-modal';

  const view = () => {
    wrapper.innerHTML = `
      <div class="login-modal__card card">
        <div class="login-modal__header">
          ${iconImg('cloud-checked', { size: 64, alt: 'Fiches & Cloud', className: 'login-modal__logo' })}
          <h2 class="login-modal__title">Fiches &amp; Cloud</h2>
          <p class="login-modal__subtitle">Votre espace d'étude et de révision</p>
        </div>

        <div class="login-modal__tabs">
          <button type="button" class="login-modal__tab ${signUpMode ? '' : 'login-modal__tab--active'}" data-mode="login">Connexion</button>
          <button type="button" class="login-modal__tab ${signUpMode ? 'login-modal__tab--active' : ''}" data-mode="signup">Inscription</button>
        </div>

        <form class="login-form" id="auth-form" novalidate>
          <div class="login-form__error" id="auth-error" role="alert" hidden></div>

          ${signUpMode ? `
            <div class="login-form__field">
              <label class="login-form__label" for="auth-name">Nom d'affichage</label>
              <input class="input" type="text" id="auth-name" placeholder="Ex : Marie Curie" autocomplete="name">
            </div>` : ''}

          <div class="login-form__field">
            <label class="login-form__label" for="auth-email">Adresse email</label>
            <input class="input" type="email" id="auth-email" placeholder="nom@exemple.fr" autocomplete="email" required>
          </div>

          <div class="login-form__field">
            <label class="login-form__label" for="auth-password">Mot de passe</label>
            <input class="input" type="password" id="auth-password" placeholder="••••••••"
                   autocomplete="${signUpMode ? 'new-password' : 'current-password'}" required>
          </div>

          <button type="submit" class="btn btn--primary login-form__submit" id="auth-submit">
            <span class="btn__text">${signUpMode ? 'Créer un compte' : 'Se connecter'}</span>
            <span class="btn__spinner" hidden></span>
          </button>
        </form>

        <div class="login-modal__footer">
          <p class="login-modal__switch">
            ${signUpMode ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"}
            <button type="button" class="btn-link" id="auth-toggle">${signUpMode ? 'Se connecter' : "S'inscrire"}</button>
          </p>
        </div>
      </div>
    `;

    wrapper.querySelectorAll('.login-modal__tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode === 'signup';
        if (mode !== signUpMode) { signUpMode = mode; view(); }
      });
    });

    wrapper.querySelector('#auth-toggle')?.addEventListener('click', () => {
      signUpMode = !signUpMode;
      view();
    });

    const form = wrapper.querySelector('#auth-form');
    const errorBox = wrapper.querySelector('#auth-error');

    form?.addEventListener('submit', async e => {
      e.preventDefault();
      errorBox.hidden = true;
      errorBox.textContent = '';

      const email = wrapper.querySelector('#auth-email')?.value.trim();
      const password = wrapper.querySelector('#auth-password')?.value;
      const name = wrapper.querySelector('#auth-name')?.value.trim() || '';

      const fail = msg => {
        errorBox.textContent = msg;
        errorBox.hidden = false;
      };

      if (!email || !password) return fail('Veuillez remplir tous les champs obligatoires.');
      if (signUpMode && !name) return fail("Veuillez renseigner un nom d'affichage.");

      const btn = wrapper.querySelector('#auth-submit');
      const label = btn.querySelector('.btn__text');
      const spinner = btn.querySelector('.btn__spinner');
      btn.disabled = true;
      label.hidden = true;
      spinner.hidden = false;

      try {
        if (signUpMode) {
          await AuthService.signUp(email, password, name);
          showToast(`Compte créé. Bienvenue, ${name} !`, 'success');
        } else {
          await AuthService.signIn(email, password);
          showToast('Connexion réussie.', 'success');
        }
        // onAuthStateChanged handles the transition.
      } catch (err) {
        console.error('[Auth]', err);
        fail(AUTH_ERRORS[err.code] || err.message || 'Une erreur est survenue. Réessayez.');
        btn.disabled = false;
        label.hidden = false;
        spinner.hidden = true;
      }
    });
  };

  view();
  showModal(wrapper, { dismissible: false });
}

/** Inform the user that Firebase is not configured. */
function renderConfigWarning() {
  const body = document.createElement('div');
  body.className = 'login-modal';
  body.innerHTML = `
    <div class="login-modal__card card">
      <div class="login-modal__header">
        ${iconImg('high-priority', { size: 56, alt: '', className: 'login-modal__logo' })}
        <h2 class="login-modal__title">Configuration requise</h2>
        <p class="login-modal__subtitle">
          Renseignez vos identifiants Firebase dans <code>src/env-config.js</code> pour activer l'authentification.
        </p>
      </div>
      <p class="login-modal__hint">
        Consultez le <strong>README.md</strong> : copiez <code>env-config.js.template</code>, encodez vos clés en Base64
        puis rechargez la page.
      </p>
    </div>
  `;
  showModal(body, { dismissible: false });
}

// ============================================================================
// Bootstrap
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Theme
  const saved = localStorage.getItem('fiches_theme');
  if (saved === 'dark' || saved === 'light') {
    AppState.theme = saved;
  } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    AppState.theme = 'dark';
  }
  document.documentElement.setAttribute('data-theme', AppState.theme);

  // 2. Layout shell
  try {
    const [navbar, dock, workspace] = await Promise.all([
      import('./components/navbar.js'),
      import('./components/dock.js'),
      import('./components/workspace.js')
    ]);

    const navbarEl = document.getElementById('navbar');
    const dockEl = document.getElementById('dock');
    const workspaceEl = document.getElementById('workspace');

    if (navbarEl) navbar.render(navbarEl);
    if (dockEl) dock.render(dockEl);
    if (workspaceEl) workspace.render(workspaceEl);
  } catch (err) {
    console.error('[App] layout components failed:', err);
    showToast('Erreur lors du chargement des composants.', 'error');
  }

  document.getElementById('boot-splash')?.remove();

  // 3. Auth lifecycle
  if (!isConfigured) {
    console.warn('[App] Firebase appears unconfigured (demo credentials).');
  }

  try {
    AuthService.onAuthStateChanged(async firebaseUser => {
      if (firebaseUser) {
        let profile = null;
        let isAdmin = false;
        try {
          profile = await AuthService.getUserProfile(firebaseUser.uid);
          isAdmin = profile?.role === 'admin' || await AuthService.isAdmin(firebaseUser.uid);
        } catch (err) {
          console.warn('[App] profile load failed, using fallback:', err);
        }

        AppState.user = firebaseUser;
        AppState.profile = profile || {
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Utilisateur',
          role: isAdmin ? 'admin' : 'user',
          shortcuts: []
        };
        AppState.isAdmin = Boolean(isAdmin);

        hideModal();
        EventBus.emit('auth:login', { user: AppState.user, profile: AppState.profile });
        EventBus.emit('app:open', { appId: 'file-explorer' });
      } else {
        AppState.user = null;
        AppState.profile = null;
        AppState.isAdmin = false;
        EventBus.emit('auth:logout', {});
        if (isConfigured) renderAuthModal();
        else renderConfigWarning();
      }
    });
  } catch (err) {
    console.error('[App] auth listener failed:', err);
    renderConfigWarning();
  }
});
