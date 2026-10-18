/**
 * Fiches & Cloud — central workspace manager.
 *
 * Turns `app:open` events into panels, loads each app module on demand, and
 * renders the welcome empty state when nothing is open.
 */

import { EventBus, AppState, showToast, iconImg } from '../app.js';
import * as splitScreen from './split-screen.js';

let host = null;
let panels = []; // { panelId, appId, params, element, contentEl, module, maximized }
const bound = {};

/** Registry of launchable applications. */
export const APP_REGISTRY = {
  'file-explorer':    { title: 'Fichiers & dossiers',   icon: 'opened-folder', modulePath: './file-explorer.js' },
  'markdown-editor':  { title: 'Éditeur Markdown',      icon: 'document',    modulePath: './markdown-editor.js' },
  'user-profile':     { title: 'Mon profil',            icon: 'guest-male',  modulePath: './user-profile.js' },
  'admin-database':   { title: 'Base de données',       icon: 'database',    modulePath: './admin-database.js' },
  'admin-users':      { title: 'Utilisateurs',          icon: 'group',       modulePath: './admin-users.js' },
  'admin-statistics': { title: 'Statistiques',          icon: 'combo-chart', modulePath: './admin-statistics.js' }
};

/** @param {HTMLElement} container */
export function render(container) {
  host = container;
  container.innerHTML = '';
  panels = [];

  splitScreen.createLayout(container, 0);
  renderEmptyState();

  bound.onAppOpen = ({ appId, params }) => openPanel(appId, params);
  bound.onPanelClose = ({ panelId }) => closePanel(panelId);
  bound.onLogout = () => closeAllPanels();

  EventBus.on('app:open', bound.onAppOpen);
  EventBus.on('panel:close', bound.onPanelClose);
  EventBus.on('auth:logout', bound.onLogout);
}

/**
 * Open (or focus) an application panel.
 * @param {string} appId
 * @param {Object} [params]
 * @returns {Promise<string|null>} panel id
 */
export async function openPanel(appId, params = {}) {
  if (!host) return null;

  const meta = APP_REGISTRY[appId];
  if (!meta) {
    console.error(`[Workspace] unknown app id "${appId}"`);
    showToast(`Application inconnue : ${appId}`, 'error');
    return null;
  }

  // Already open → optionally re-render with new params, then focus.
  const existing = panels.find(p => p.appId === appId);
  if (existing) {
    if (params && Object.keys(params).length > 0 && existing.module?.render) {
      existing.params = params;
      try {
        existing.module.render(existing.contentEl, params);
      } catch (err) {
        console.error(`[Workspace] re-render failed for ${appId}:`, err);
      }
    }
    focusPanel(existing);
    return existing.panelId;
  }

  if (panels.length >= 3) {
    showToast('Limite de 3 volets atteinte. Fermez un volet pour en ouvrir un autre.', 'info');
    return null;
  }

  clearEmptyState();

  const element = splitScreen.addPanel(host);
  if (!element) {
    showToast("Impossible d'ajouter un volet.", 'error');
    return null;
  }

  const panelId = `panel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  element.dataset.panelId = panelId;
  element.dataset.appId = appId;

  const header = document.createElement('header');
  header.className = 'panel-header';
  header.innerHTML = `
    <div class="panel-header__title">
      ${iconImg(meta.icon, { size: 18, alt: '', className: 'panel-header__icon' })}
      <span class="panel-header__text">${meta.title}</span>
    </div>
    <div class="panel-header__actions">
      <button type="button" class="panel-header__btn" data-action="maximize" title="Agrandir / Réduire" aria-label="Agrandir le volet">
        ${iconImg('full-screen', { size: 16, alt: '' })}
      </button>
      <button type="button" class="panel-header__btn panel-header__btn--close" data-action="close" title="Fermer le volet" aria-label="Fermer le volet">
        ${iconImg('close-window', { size: 16, alt: '' })}
      </button>
    </div>
  `;

  const contentEl = document.createElement('div');
  contentEl.className = 'workspace__panel-content';
  contentEl.innerHTML = `<div class="panel-loading"><span class="spinner"></span><p>Chargement de ${meta.title}…</p></div>`;

  element.append(header, contentEl);

  const record = { panelId, appId, params, element, contentEl, module: null, maximized: false };

  header.querySelector('[data-action="maximize"]')?.addEventListener('click', () => toggleMaximize(record));
  header.querySelector('[data-action="close"]')?.addEventListener('click', () => closePanel(panelId));

  try {
    const mod = await import(meta.modulePath);
    contentEl.innerHTML = '';
    await mod.render(contentEl, params);
    record.module = mod;
  } catch (err) {
    console.error(`[Workspace] failed to load ${appId}:`, err);
    contentEl.innerHTML = `
      <div class="panel-error card">
        <p class="panel-error__title">Erreur de chargement</p>
        <p class="panel-error__text">Impossible d'initialiser ${meta.title}.</p>
      </div>`;
    showToast(`Erreur de chargement pour ${meta.title}`, 'error');
  }

  panels.push(record);
  return panelId;
}

/** Close a panel by id. */
export function closePanel(panelId) {
  const index = panels.findIndex(p => p.panelId === panelId);
  if (index === -1) return;

  const panel = panels[index];
  if (panel.maximized) toggleMaximize(panel);

  try {
    if (typeof panel.module?.destroy === 'function') panel.module.destroy();
  } catch (err) {
    console.error(`[Workspace] destroy failed for ${panel.appId}:`, err);
  }

  splitScreen.removePanel(host, panel.element);
  panels.splice(index, 1);
  EventBus.emit('panel:close', { panelId });

  if (panels.length === 0) renderEmptyState();
}

/** Close every panel (e.g. on logout). */
function closeAllPanels() {
  [...panels].forEach(p => closePanel(p.panelId));
}

/** Scroll to and briefly highlight a panel. */
function focusPanel(panel) {
  panel.element.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  panel.element.classList.add('workspace__panel--focused');
  setTimeout(() => panel.element.classList.remove('workspace__panel--focused'), 700);
}

/** Maximize / restore a panel. */
function toggleMaximize(panel) {
  panel.maximized = !panel.maximized;
  const icon = panel.element.querySelector('[data-action="maximize"] img');

  if (panel.maximized) {
    panel.element.classList.add('workspace__panel--maximized');
    if (icon) icon.src = 'https://img.icons8.com/fluency/200/collapse.png';
    panels.forEach(p => { if (p.panelId !== panel.panelId) p.element.hidden = true; });
    host?.querySelectorAll('.workspace__divider').forEach(d => { d.hidden = true; });
  } else {
    panel.element.classList.remove('workspace__panel--maximized');
    if (icon) icon.src = 'https://img.icons8.com/fluency/200/full-screen.png';
    panels.forEach(p => { p.element.hidden = false; });
    host?.querySelectorAll('.workspace__divider').forEach(d => { d.hidden = false; });
  }
}

/** Welcome dashboard shown when no panel is open. */
function renderEmptyState() {
  if (!host || host.querySelector('.empty-state')) return;

  const admin = Boolean(AppState.isAdmin || AppState.profile?.role === 'admin');

  const card = (id, icon, title, desc) => `
    <button type="button" class="empty-state__action" id="${id}">
      ${iconImg(icon, { size: 32, alt: '', className: 'empty-state__action-icon' })}
      <span class="empty-state__action-title">${title}</span>
      <span class="empty-state__action-desc">${desc}</span>
    </button>`;

  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <div class="empty-state__card card">
      ${iconImg('cloud-checked', { size: 64, alt: '', className: 'empty-state__icon' })}
      <h2 class="empty-state__title">Bienvenue dans Fiches &amp; Cloud</h2>
      <p class="empty-state__description">
        Votre espace de révision connecté. Consultez vos cours, rédigez de nouvelles fiches
        en Markdown avec KaTeX, ou organisez vos ressources web.
      </p>
      <div class="empty-state__grid">
        ${card('quick-explorer', 'opened-folder', 'Fichiers', 'Dossiers, fiches et liens')}
        ${card('quick-editor', 'document', 'Nouvelle fiche', 'Rédiger en Markdown + Math')}
        ${card('quick-profile', 'guest-male', 'Mon profil', 'Compte, bio et sécurité')}
        ${admin ? card('quick-stats', 'combo-chart', 'Statistiques', "Métriques d'administration") : ''}
      </div>
    </div>
  `;

  el.querySelector('#quick-explorer')?.addEventListener('click', () => openPanel('file-explorer'));
  el.querySelector('#quick-editor')?.addEventListener('click', () => openPanel('markdown-editor'));
  el.querySelector('#quick-profile')?.addEventListener('click', () => openPanel('user-profile'));
  el.querySelector('#quick-stats')?.addEventListener('click', () => openPanel('admin-statistics'));

  host.appendChild(el);
}

/** Remove the welcome state. */
function clearEmptyState() {
  host?.querySelector('.empty-state')?.remove();
}

/** Tear down the workspace. */
export function destroy() {
  closeAllPanels();
  EventBus.off('app:open', bound.onAppOpen);
  EventBus.off('panel:close', bound.onPanelClose);
  EventBus.off('auth:logout', bound.onLogout);
  if (host) { host.innerHTML = ''; host = null; }
}
