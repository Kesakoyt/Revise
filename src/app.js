/**
 * Fiches & Cloud — Main Application Entry Point
 * Manages global event bus, reactive application state, modal/toast subsystems,
 * component initialization, and Firebase authentication lifecycle.
 */

import { AuthService } from './services/auth-service.js';

// ============================================================================
// Event Bus
// ============================================================================
export const EventBus = {
  _events: {},

  /**
   * Subscribe to an event
   * @param {string} event 
   * @param {Function} callback 
   */
  on(event, callback) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(callback);
  },

  /**
   * Unsubscribe from an event
   * @param {string} event 
   * @param {Function} callback 
   */
  off(event, callback) {
    if (!this._events[event]) return;
    this._events[event] = this._events[event].filter(cb => cb !== callback);
  },

  /**
   * Emit an event to all registered listeners
   * @param {string} event 
   * @param {any} data 
   */
  emit(event, data) {
    if (!this._events[event]) return;
    // Iterate over a slice to allow unsubscriptions during execution
    const listeners = [...this._events[event]];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[EventBus] Error in listener for event "${event}":`, err);
      }
    });
  }
};

// ============================================================================
// App State
// ============================================================================
export const AppState = {
  user: null,        // Firebase User instance or null
  profile: null,     // User profile data from Firestore
  theme: 'light',    // 'light' | 'dark'
  isAdmin: false
};

// ============================================================================
// Toast Notification Subsystem
// ============================================================================
/**
 * Display a floating toast notification with Fluent Design styling
 * @param {string} message - Content to display
 * @param {'info' | 'success' | 'error' | 'warning'} type - Visual style category
 * @param {number} duration - Auto-dismiss delay in ms (default 3500ms)
 * @returns {HTMLElement} The created toast element
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return null;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');

  // Choose icon based on type
  const iconMap = {
    info: 'https://img.icons8.com/fluency/20/info.png',
    success: 'https://img.icons8.com/fluency/20/ok.png',
    error: 'https://img.icons8.com/fluency/20/cancel.png',
    warning: 'https://img.icons8.com/fluency/20/high-priority.png'
  };

  const iconUrl = iconMap[type] || iconMap.info;

  toast.innerHTML = `
    <img src="${iconUrl}" alt="${type}" class="toast__icon" width="20" height="20">
    <span class="toast__message">${message}</span>
    <button type="button" class="toast__close" aria-label="Fermer la notification">&times;</button>
  `;

  const removeToast = () => {
    if (toast.classList.contains('toast--hiding')) return;
    toast.classList.add('toast--hiding');
    toast.addEventListener('transitionend', () => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, { once: true });
    // Fallback removal if transition doesn't fire
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  };

  const closeBtn = toast.querySelector('.toast__close');
  if (closeBtn) {
    closeBtn.addEventListener('click', removeToast);
  }

  container.appendChild(toast);

  // Trigger entrance transition on next animation frame
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }

  return toast;
}

// ============================================================================
// Modal Subsystem
// ============================================================================
let currentEscHandler = null;

/**
 * Display a modal dialog overlay
 * @param {string | HTMLElement} content - Modal content or element
 * @param {Object} [options]
 * @param {boolean} [options.dismissible=true] - Whether user can dismiss via ESC / backdrop
 * @param {Function} [options.onClose] - Callback upon modal closure
 * @returns {{ modalElement: HTMLElement, hide: Function }}
 */
export function showModal(content, options = {}) {
  const { dismissible = true, onClose = null } = options;
  const container = document.getElementById('modal-container');
  if (!container) return { modalElement: null, hide: () => {} };

  // Clear existing modal if present
  hideModal();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const overlay = document.createElement('div');
  overlay.className = 'modal__overlay';

  const modalContent = document.createElement('div');
  modalContent.className = 'modal__content';

  if (typeof content === 'string') {
    modalContent.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    modalContent.appendChild(content);
  }

  modal.appendChild(overlay);
  modal.appendChild(modalContent);
  container.appendChild(modal);

  // Close function
  const close = () => {
    if (modal.classList.contains('modal--hiding')) return;
    modal.classList.add('modal--hiding');
    
    if (currentEscHandler) {
      document.removeEventListener('keydown', currentEscHandler);
      currentEscHandler = null;
    }

    setTimeout(() => {
      if (modal.parentElement) {
        modal.parentElement.removeChild(modal);
      }
      if (typeof onClose === 'function') {
        onClose();
      }
    }, 200);
  };

  if (dismissible) {
    overlay.addEventListener('click', close);
    currentEscHandler = (e) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', currentEscHandler);
  }

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('modal--visible');
  });

  return { modalElement: modal, hide: close };
}

/**
 * Hide the currently active modal
 */
export function hideModal() {
  const container = document.getElementById('modal-container');
  if (!container) return;

  if (currentEscHandler) {
    document.removeEventListener('keydown', currentEscHandler);
    currentEscHandler = null;
  }

  const existingModals = container.querySelectorAll('.modal');
  existingModals.forEach(m => {
    m.classList.add('modal--hiding');
    setTimeout(() => {
      if (m.parentElement) m.parentElement.removeChild(m);
    }, 200);
  });
}

// ============================================================================
// Authentication / Login Modal
// ============================================================================
/**
 * Render the dedicated Fluent authentication modal for unauthenticated users
 */
function renderLoginModal() {
  let isSignUpMode = false;

  const modalWrapper = document.createElement('div');
  modalWrapper.className = 'login-modal';

  function updateView() {
    modalWrapper.innerHTML = `
      <div class="login-modal__card card">
        <div class="login-modal__header">
          <img src="https://img.icons8.com/fluency/64/cloud-checked.png" alt="Logo" class="login-modal__logo" width="56" height="56">
          <h2 class="login-modal__title">Fiches & Cloud</h2>
          <p class="login-modal__subtitle">Votre espace d'étude et de révision intelligent</p>
        </div>

        <div class="login-modal__tabs">
          <button type="button" class="login-modal__tab ${!isSignUpMode ? 'login-modal__tab--active' : ''}" id="tab-login">
            Connexion
          </button>
          <button type="button" class="login-modal__tab ${isSignUpMode ? 'login-modal__tab--active' : ''}" id="tab-signup">
            Inscription
          </button>
        </div>

        <form class="login-form" id="auth-form" novalidate>
          <div id="auth-error" class="login-form__error" style="display: none;" role="alert"></div>

          ${isSignUpMode ? `
            <div class="login-form__field">
              <label for="auth-display-name" class="login-form__label">Nom d'affichage</label>
              <input type="text" id="auth-display-name" class="input" placeholder="Ex: Marie Curie" required autocomplete="name">
            </div>
          ` : ''}

          <div class="login-form__field">
            <label for="auth-email" class="login-form__label">Adresse email</label>
            <input type="email" id="auth-email" class="input" placeholder="nom@exemple.fr" required autocomplete="email">
          </div>

          <div class="login-form__field">
            <label for="auth-password" class="login-form__label">Mot de passe</label>
            <input type="password" id="auth-password" class="input" placeholder="••••••••" required autocomplete="${isSignUpMode ? 'new-password' : 'current-password'}">
          </div>

          <button type="submit" class="btn btn--primary login-form__submit" id="auth-submit-btn">
            <span class="btn__text">${isSignUpMode ? "Créer un compte" : "Se connecter"}</span>
            <span class="btn__spinner" style="display: none;"></span>
          </button>
        </form>

        <div class="login-modal__footer">
          <p class="login-modal__switch">
            ${isSignUpMode ? 'Vous avez déjà un compte ?' : "Vous n'avez pas encore de compte ?"}
            <button type="button" class="btn-link" id="auth-toggle-mode">
              ${isSignUpMode ? 'Se connecter' : "S'inscrire"}
            </button>
          </p>
        </div>
      </div>
    `;

    // Tab buttons
    modalWrapper.querySelector('#tab-login')?.addEventListener('click', () => {
      if (isSignUpMode) {
        isSignUpMode = false;
        updateView();
      }
    });

    modalWrapper.querySelector('#tab-signup')?.addEventListener('click', () => {
      if (!isSignUpMode) {
        isSignUpMode = true;
        updateView();
      }
    });

    modalWrapper.querySelector('#auth-toggle-mode')?.addEventListener('click', () => {
      isSignUpMode = !isSignUpMode;
      updateView();
    });

    // Form submit
    const form = modalWrapper.querySelector('#auth-form');
    const errorBox = modalWrapper.querySelector('#auth-error');
    const submitBtn = modalWrapper.querySelector('#auth-submit-btn');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      errorBox.textContent = '';

      const emailInput = modalWrapper.querySelector('#auth-email');
      const passwordInput = modalWrapper.querySelector('#auth-password');
      const nameInput = modalWrapper.querySelector('#auth-display-name');

      const email = emailInput?.value.trim();
      const password = passwordInput?.value;
      const displayName = nameInput ? nameInput.value.trim() : '';

      if (!email || !password) {
        errorBox.textContent = 'Veuillez remplir tous les champs obligatoires.';
        errorBox.style.display = 'block';
        return;
      }

      if (isSignUpMode && !displayName) {
        errorBox.textContent = "Veuillez renseigner un nom d'affichage.";
        errorBox.style.display = 'block';
        return;
      }

      // Loading state
      submitBtn.disabled = true;
      const btnText = submitBtn.querySelector('.btn__text');
      const btnSpinner = submitBtn.querySelector('.btn__spinner');
      if (btnText) btnText.style.display = 'none';
      if (btnSpinner) btnSpinner.style.display = 'inline-block';

      try {
        if (isSignUpMode) {
          await AuthService.signUp(email, password, displayName);
          showToast(`Compte créé avec succès ! Bienvenue, ${displayName}.`, 'success');
        } else {
          await AuthService.signIn(email, password);
          showToast('Connexion réussie !', 'success');
        }
        // State change is handled by onAuthStateChanged listener
      } catch (err) {
        console.error('[Auth] Error:', err);
        let errorMsg = 'Une erreur est survenue lors de la connexion.';
        if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
          errorMsg = 'Identifiants incorrects. Veuillez vérifier votre email et mot de passe.';
        } else if (err.code === 'auth/email-already-in-use') {
          errorMsg = 'Cette adresse email est déjà associée à un compte existant.';
        } else if (err.code === 'auth/weak-password') {
          errorMsg = 'Le mot de passe doit comporter au moins 6 caractères.';
        } else if (err.code === 'auth/invalid-email') {
          errorMsg = 'Adresse email invalide.';
        } else if (err.message) {
          errorMsg = err.message;
        }

        errorBox.textContent = errorMsg;
        errorBox.style.display = 'block';

        submitBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline-block';
        if (btnSpinner) btnSpinner.style.display = 'none';
      }
    });
  }

  updateView();

  // Show as non-dismissible modal when not authenticated
  showModal(modalWrapper, { dismissible: false });
}

// ============================================================================
// Initialization Lifecycle
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Theme from localStorage or system preference
  const savedTheme = localStorage.getItem('fiches_theme') || localStorage.getItem('theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    AppState.theme = savedTheme;
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    AppState.theme = 'dark';
  } else {
    AppState.theme = 'light';
  }
  document.documentElement.setAttribute('data-theme', AppState.theme);

  // 2. Dynamically import top-level layout components
  let navbarModule, dockModule, workspaceModule;
  try {
    const modules = await Promise.all([
      import('./components/navbar.js'),
      import('./components/dock.js'),
      import('./components/workspace.js')
    ]);
    navbarModule = modules[0];
    dockModule = modules[1];
    workspaceModule = modules[2];

    const navbarEl = document.getElementById('navbar');
    const dockEl = document.getElementById('dock');
    const workspaceEl = document.getElementById('workspace');

    if (navbarEl) navbarModule.render(navbarEl);
    if (dockEl) dockModule.render(dockEl);
    if (workspaceEl) workspaceModule.render(workspaceEl);
  } catch (err) {
    console.error('[App] Failed to load layout components:', err);
    showToast('Erreur lors du chargement des composants.', 'error');
  }

  // 3. Set up Firebase Authentication state listener
  try {
    AuthService.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        // Authenticated user
        try {
          const profile = await AuthService.getUserProfile(firebaseUser.uid);
          let isAdmin = false;
          if (profile && profile.role === 'admin') {
            isAdmin = true;
          } else if (typeof AuthService.isAdmin === 'function') {
            isAdmin = await AuthService.isAdmin(firebaseUser.uid);
          }

          AppState.user = firebaseUser;
          AppState.profile = profile || {
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Utilisateur',
            role: isAdmin ? 'admin' : 'user',
            shortcuts: []
          };
          AppState.isAdmin = Boolean(isAdmin);

          // Close login modal if present
          hideModal();

          // Broadcast login event across the application
          EventBus.emit('auth:login', {
            user: AppState.user,
            profile: AppState.profile
          });

          // Open default workspace app if no panels are opened
          EventBus.emit('app:open', { appId: 'file-explorer' });

        } catch (profileErr) {
          console.error('[App] Error fetching profile:', profileErr);
          AppState.user = firebaseUser;
          AppState.profile = {
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || 'Utilisateur',
            role: 'user',
            shortcuts: []
          };
          AppState.isAdmin = false;
          hideModal();
          EventBus.emit('auth:login', { user: AppState.user, profile: AppState.profile });
        }
      } else {
        // Unauthenticated / Logged out
        AppState.user = null;
        AppState.profile = null;
        AppState.isAdmin = false;

        EventBus.emit('auth:logout', {});
        renderLoginModal();
      }
    });
  } catch (authErr) {
    console.error('[App] Failed to initialize AuthService listener:', authErr);
    renderLoginModal();
  }
});
