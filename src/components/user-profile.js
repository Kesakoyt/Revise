/**
 * Fiches & Cloud — user profile app.
 *
 * The signed-in user's account page: identity, editable profile (display name,
 * bio, avatar colour), storage usage and password management. Edits are written
 * to `users/{uid}` and mirrored on the Firebase Auth record for the display name.
 */

import { EventBus, AppState, showToast, iconImg } from '../app.js';
import { AuthService } from '../services/auth-service.js';
import { FirestoreService } from '../services/firestore-service.js';
import { QuotaManager } from '../services/quota-manager.js';

/** Avatar colour palette offered in the editor. */
const AVATAR_COLORS = [
  '#0078d4', '#2e7d32', '#c2185b', '#7b1fa2',
  '#ef6c00', '#00838f', '#5d4037', '#455a64'
];

const BIO_MAX = 280;

const state = {
  container: null,
  profile: null,
  notes: 0,
  links: 0,
  chars: 0,
  quota: { used: 0, limit: 500000, percentage: 0 },
  editing: false,
  busy: false
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  state.editing = false;
  container.classList.add('profile-container');

  container.innerHTML = `
    <div class="profile-app">
      <div class="loading-block"><span class="spinner"></span><p>Chargement du profil…</p></div>
    </div>`;

  await load();
  renderApp();
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function load() {
  const uid = AppState.user?.uid;
  if (!uid) return;

  const safe = p => p.catch(err => { console.warn('[Profile] load failed:', err); return null; });

  const [profile, notes, links, quota] = await Promise.all([
    safe(AuthService.getUserProfile(uid)),
    safe(FirestoreService.getUserNotes(uid)),
    safe(FirestoreService.getUserLinks(uid)),
    safe(QuotaManager.getQuotaInfo(uid))
  ]);

  state.profile = profile || AppState.profile || {
    email: AppState.user?.email || '',
    displayName: AppState.user?.displayName || ''
  };

  const noteList = notes || [];
  state.notes = noteList.length;
  state.links = (links || []).length;
  state.chars = noteList.reduce(
    (sum, n) => sum + (typeof n.charCount === 'number' ? n.charCount : (n.content || '').length),
    0
  );

  state.quota = quota || {
    used: state.chars,
    limit: state.profile.quotaLimit || 500000,
    percentage: 0
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderApp() {
  const c = state.container;
  if (!c) return;

  const p = state.profile || {};
  const displayName = p.displayName || AppState.user?.displayName || 'Utilisateur';
  const email = p.email || AppState.user?.email || '—';
  const admin = Boolean(AppState.isAdmin || p.role === 'admin');
  const color = p.avatarColor || AVATAR_COLORS[0];

  c.innerHTML = `
    <div class="profile-app">
      <header class="profile-app__header card">
        <span class="profile-app__avatar" style="background:${escapeAttr(color)}">${escapeHtml(initial(displayName))}</span>
        <div class="profile-app__identity">
          <h2 class="profile-app__name">${escapeHtml(displayName)}</h2>
          <p class="profile-app__email">${escapeHtml(email)}</p>
          <div class="profile-app__meta">
            <span class="badge ${admin ? 'badge--admin' : 'badge--user'}">${admin ? 'Admin' : 'Étudiant'}</span>
            <span class="profile-app__since">Membre depuis le ${formatDate(p.createdAt)}</span>
          </div>
        </div>
      </header>

      <div class="profile-app__body">
        ${renderInfoSection(p)}
        ${renderStorageSection()}
        ${renderSecuritySection(email)}
      </div>
    </div>
  `;

  bind();
}

function renderInfoSection(p) {
  if (state.editing) return renderInfoEdit(p);

  const bio = p.bio?.trim();
  return `
    <section class="profile-section">
      <div class="profile-section__head">
        <h3>Informations personnelles</h3>
        <button type="button" class="btn btn--secondary btn--sm" id="profile-edit">
          ${iconImg('edit', { size: 15, alt: '' })}<span>Modifier</span>
        </button>
      </div>

      <div class="profile-field">
        <span class="profile-field__label">Nom d'affichage</span>
        <span class="profile-field__value">${escapeHtml(p.displayName || '—')}</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">Adresse email</span>
        <span class="profile-field__value">${escapeHtml(p.email || '—')}</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">Biographie</span>
        <span class="profile-field__value ${bio ? '' : 'profile-field__value--muted'}">${bio ? escapeHtml(bio) : 'Aucune biographie renseignée.'}</span>
      </div>
    </section>`;
}

function renderInfoEdit(p) {
  const color = p.avatarColor || AVATAR_COLORS[0];

  const swatch = c => `
    <button type="button" class="avatar-picker__swatch ${c === color ? 'avatar-picker__swatch--active' : ''}"
            data-color="${escapeAttr(c)}" style="background:${escapeAttr(c)}"
            title="${escapeAttr(c)}" aria-label="Couleur ${escapeAttr(c)}"></button>`;

  return `
    <section class="profile-section">
      <div class="profile-section__head">
        <h3>Informations personnelles</h3>
      </div>

      <form class="profile-form" id="profile-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="pf-name">Nom d'affichage <span class="required">*</span></label>
          <input class="input" type="text" id="pf-name" maxlength="40"
                 value="${escapeAttr(p.displayName || '')}" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="pf-bio">Biographie</label>
          <textarea class="textarea" id="pf-bio" maxlength="${BIO_MAX}" rows="3"
                    placeholder="Quelques mots sur vous, vos matières préférées…">${escapeHtml(p.bio || '')}</textarea>
          <span class="form-hint" id="pf-bio-count">${(p.bio || '').length} / ${BIO_MAX}</span>
        </div>

        <div class="form-group">
          <span class="form-label">Couleur de l'avatar</span>
          <div class="avatar-picker" id="pf-colors" role="group" aria-label="Couleur de l'avatar">
            ${AVATAR_COLORS.map(swatch).join('')}
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn--secondary" id="profile-cancel">Annuler</button>
          <button type="submit" class="btn btn--primary" id="profile-save">Enregistrer</button>
        </div>
      </form>
    </section>`;
}

function renderStorageSection() {
  const { used, limit, percentage } = state.quota;
  const { usedFormatted, limitFormatted } = QuotaManager.formatQuota(used, limit);
  const pct = Number.isFinite(percentage) ? percentage : Math.round((used / (limit || 1)) * 100);

  return `
    <section class="profile-section">
      <div class="profile-section__head"><h3>Stockage</h3></div>

      <div class="profile-quota">
        <div class="profile-quota__head">
          <span class="profile-quota__label">${usedFormatted} / ${limitFormatted} caractères</span>
          <span class="profile-quota__pct">${pct}%</span>
        </div>
        <div class="profile-quota__track">
          <div class="profile-quota__fill" style="width:${Math.min(100, pct)}%"></div>
        </div>
      </div>

      <div class="stat-chips">
        <span class="stat-chip"><strong>${state.notes}</strong> fiche${state.notes === 1 ? '' : 's'}</span>
        <span class="stat-chip"><strong>${state.links}</strong> lien${state.links === 1 ? '' : 's'}</span>
        <span class="stat-chip"><strong>${state.chars.toLocaleString('fr-FR')}</strong> caractères rédigés</span>
      </div>
    </section>`;
}

function renderSecuritySection(email) {
  const verified = Boolean(AppState.user?.emailVerified);
  return `
    <section class="profile-section">
      <div class="profile-section__head"><h3>Sécurité</h3></div>

      <div class="profile-field">
        <span class="profile-field__label">Adresse email</span>
        <span class="profile-field__value">
          ${escapeHtml(email)}
          <span class="badge ${verified ? 'badge--public' : 'badge--user'}">${verified ? 'Vérifiée' : 'Non vérifiée'}</span>
        </span>
      </div>

      <p class="profile-app__hint">
        Un email de réinitialisation vous sera envoyé pour définir un nouveau mot de passe.
      </p>
      <div class="profile-section__actions">
        <button type="button" class="btn btn--secondary" id="profile-reset-password">
          ${iconImg('key', { size: 16, alt: '' })}<span>Réinitialiser le mot de passe</span>
        </button>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bind() {
  const c = state.container;
  if (!c) return;

  c.querySelector('#profile-edit')?.addEventListener('click', () => {
    state.editing = true;
    renderApp();
    c.querySelector('#pf-name')?.focus();
  });

  c.querySelector('#profile-cancel')?.addEventListener('click', () => {
    state.editing = false;
    renderApp();
  });

  const bio = c.querySelector('#pf-bio');
  const bioCount = c.querySelector('#pf-bio-count');
  bio?.addEventListener('input', () => {
    if (bioCount) bioCount.textContent = `${bio.value.length} / ${BIO_MAX}`;
  });

  c.querySelectorAll('.avatar-picker__swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      c.querySelectorAll('.avatar-picker__swatch')
        .forEach(s => s.classList.toggle('avatar-picker__swatch--active', s === sw));
    });
  });

  c.querySelector('#profile-form')?.addEventListener('submit', handleSave);
  c.querySelector('#profile-reset-password')?.addEventListener('click', handlePasswordReset);
}

async function handleSave(e) {
  e.preventDefault();
  if (state.busy) return;

  const c = state.container;
  const nameInput = c?.querySelector('#pf-name');
  const name = nameInput?.value.trim() || '';

  if (!name) {
    showToast("Le nom d'affichage est requis.", 'error');
    nameInput?.focus();
    return;
  }

  const bio = (c.querySelector('#pf-bio')?.value || '').trim();
  const active = c.querySelector('.avatar-picker__swatch--active');
  const avatarColor = active?.dataset.color || state.profile?.avatarColor || AVATAR_COLORS[0];

  const uid = AppState.user?.uid;
  if (!uid) return;

  const saveBtn = c.querySelector('#profile-save');
  state.busy = true;
  if (saveBtn) saveBtn.disabled = true;

  try {
    await AuthService.updateUserProfile(uid, { displayName: name, bio, avatarColor });

    // Mirror the display name on the Firebase Auth record (best effort).
    if (AppState.user?.updateProfile) {
      try {
        await AppState.user.updateProfile({ displayName: name });
      } catch (err) {
        console.warn('[Profile] auth displayName update skipped:', err);
      }
    }

    state.profile = { ...(state.profile || {}), displayName: name, bio, avatarColor };
    AppState.profile = { ...(AppState.profile || {}), displayName: name, bio, avatarColor };
    EventBus.emit('profile:updated', { uid, profile: state.profile });

    state.editing = false;
    renderApp();
    showToast('Profil mis à jour.', 'success');
  } catch (err) {
    console.error('[Profile] save failed:', err);
    showToast(`Échec de l'enregistrement : ${err.message}`, 'error');
  } finally {
    state.busy = false;
  }
}

async function handlePasswordReset() {
  if (state.busy) return;

  const email = state.profile?.email || AppState.user?.email;
  if (!email) {
    showToast('Aucune adresse email associée à ce compte.', 'error');
    return;
  }

  const btn = state.container?.querySelector('#profile-reset-password');
  state.busy = true;
  if (btn) btn.disabled = true;

  try {
    await AuthService.sendPasswordReset(email);
    showToast(`Email de réinitialisation envoyé à ${email}.`, 'success');
  } catch (err) {
    console.error('[Profile] password reset failed:', err);
    showToast(`Échec de l'envoi : ${err.message}`, 'error');
  } finally {
    state.busy = false;
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function formatDate(ts) {
  const ms = millis(ts);
  return ms
    ? new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
}

function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

/** Tear down. */
export function destroy() {
  state.container = null;
  state.profile = null;
  state.notes = 0;
  state.links = 0;
  state.chars = 0;
  state.quota = { used: 0, limit: 500000, percentage: 0 };
  state.editing = false;
  state.busy = false;
}
