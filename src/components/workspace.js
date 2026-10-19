/**
 * Fiches & Cloud — central workspace manager.
 *
 * Turns `app:open` events into panels, loads each app module on demand, and
 * renders the welcome empty state when nothing is open.
 *
 * The workspace sits in one of two layouts:
 *
 *   - `full`  (default) — a single window fills the workspace. A strip of open
 *     windows is shown at the top so you can jump between them.
 *   - `split` — every open window sits side by side with draggable dividers.
 *
 * Both layouts are reachable from the two buttons in every panel header
 * (*Plein écran* / *Écran divisé*). A newly opened window always starts full
 * screen.
 */

import { EventBus, AppState, showToast, iconImg } from '../app.js';
import * as splitScreen from './split-screen.js';

let root = null;      // .workspace — column layout: window strip + stage
let host = null;      // .workspace__stage — row layout: panels + dividers
let tabsEl = null;    // .workspace__tabs — window switcher, used by `full`
let panels = [];      // { panelId, appId, params, element, contentEl, module }
let layout = 'full';  // 'full' | 'split'
let activePanelId = null;
const bound = {};

/** Registry of launchable applications. */
export const APP_REGISTRY = {
  'file-explorer':    { title: 'Fichiers & dossiers',   icon: 'opened-folder', modulePath: './file-explorer.js' },
  'markdown-editor':  { title: 'Éditeur Markdown',      icon: 'document',    modulePath: './markdown-editor.js' },
  'user-profile':     { title: 'Mon profil',            icon: 'guest-male',  modulePath: './user-profile.js' },
  'admin-database':   { title: 'Base de données',       icon: 'database',    modulePath: './admin-database.js' },
  'admin-users':      { title: 'Utilisateurs',          icon: 'group',       modulePath: './admin-users.js' },
  'admin-shares':     { title: 'Partages',              icon: 'share',       modulePath: './admin-shares.js' },
  'admin-statistics': { title: 'Statistiques',          icon: 'combo-chart', modulePath: './admin-statistics.js' }
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** @param {HTMLElement} container */
export function render(container) {
  root = container;
  container.innerHTML = '';
  container.classList.remove('workspace--split-layout');
  container.style.display = '';
  container.style.flexDirection = '';
  container.style.alignItems = '';
  container.style.gap = '';

  tabsEl = document.createElement('nav');
  tabsEl.className = 'workspace__tabs';
  tabsEl.setAttribute('aria-label', 'Fenêtres ouvertes');
  tabsEl.hidden = true;

  host = document.createElement('div');
  host.className = 'workspace__stage';

  container.append(tabsEl, host);

  panels = [];
  layout = 'full';
  activePanelId = null;

  splitScreen.createLayout(host, 0);
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
  if (!root || !host) return null;

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
    // In the full layout only one window is visible: bring this one forward.
    if (layout === 'full' && existing.panelId !== activePanelId) {
      activePanelId = existing.panelId;
      applyLayout();
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
      <span class="panel-header__text">${escapeHtml(meta.title)}</span>
    </div>
    <div class="panel-header__actions">
      <button type="button" class="panel-header__btn" data-action="full-screen" title="Plein écran" aria-label="Afficher ce volet en plein écran">
        ${iconImg('full-screen', { size: 16, alt: '' })}
      </button>
      <button type="button" class="panel-header__btn" data-action="split-screen" title="Écran divisé" aria-label="Afficher les volets côte à côte">
        ${iconImg('split-vertical', { size: 16, alt: '' })}
      </button>
      <button type="button" class="panel-header__btn panel-header__btn--close" data-action="close" title="Fermer le volet" aria-label="Fermer le volet">
        ${iconImg('close-window', { size: 16, alt: '' })}
      </button>
    </div>
  `;

  const contentEl = document.createElement('div');
  contentEl.className = 'workspace__panel-content';
  contentEl.innerHTML = `<div class="panel-loading"><span class="spinner"></span><p>Chargement de ${escapeHtml(meta.title)}…</p></div>`;

  element.append(header, contentEl);

  const record = { panelId, appId, params, element, contentEl, module: null };

  header.querySelector('[data-action="full-screen"]')?.addEventListener('click', () => setLayout('full', panelId));
  header.querySelector('[data-action="split-screen"]')?.addEventListener('click', () => setLayout('split'));
  header.querySelector('[data-action="close"]')?.addEventListener('click', () => closePanel(panelId));

  panels.push(record);
  // A freshly opened window starts full screen.
  setLayout('full', panelId);

  try {
    const mod = await import(meta.modulePath);
    if (!panels.includes(record)) return panelId; // closed while importing

    contentEl.innerHTML = '';
    await mod.render(contentEl, params);

    if (!panels.includes(record)) {
      // Closed while the app was still initialising — undo its hooks.
      try { if (typeof mod.destroy === 'function') mod.destroy(); }
      catch (err) { console.error(`[Workspace] destroy failed for ${appId}:`, err); }
      return panelId;
    }
    record.module = mod;
  } catch (err) {
    console.error(`[Workspace] failed to load ${appId}:`, err);
    contentEl.innerHTML = `
      <div class="panel-error card">
        <p class="panel-error__title">Erreur de chargement</p>
        <p class="panel-error__text">Impossible d'initialiser ${escapeHtml(meta.title)}.</p>
      </div>`;
    showToast(`Erreur de chargement pour ${meta.title}`, 'error');
  }

  return panelId;
}

/** Close a panel by id. */
export function closePanel(panelId) {
  const index = panels.findIndex(p => p.panelId === panelId);
  if (index === -1) return;

  const panel = panels[index];
  try {
    if (typeof panel.module?.destroy === 'function') panel.module.destroy();
  } catch (err) {
    console.error(`[Workspace] destroy failed for ${panel.appId}:`, err);
  }

  const wasActive = panel.panelId === activePanelId;
  splitScreen.removePanel(host, panel.element);
  panels.splice(index, 1);

  // Hand the full layout over to whatever window was opened most recently.
  if (wasActive) activePanelId = panels[panels.length - 1]?.panelId || null;
  applyLayout();

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

// ---------------------------------------------------------------------------
// Layout (full screen ⇄ split screen)
// ---------------------------------------------------------------------------

/**
 * Switch the workspace layout.
 * @param {'full'|'split'} mode
 * @param {string} [panelId] window to show when switching to `full`
 */
function setLayout(mode, panelId) {
  if (mode === 'split') {
    layout = 'split';
  } else {
    layout = 'full';
    if (panelId && panels.some(p => p.panelId === panelId)) activePanelId = panelId;
  }
  applyLayout();
}

/** Reflect `layout` + `activePanelId` onto the DOM (panels, dividers, buttons, tabs). */
function applyLayout() {
  if (!host) return;

  const full = layout === 'full';
  const active = panels.find(p => p.panelId === activePanelId) || panels[panels.length - 1] || null;
  activePanelId = active ? active.panelId : null;

  panels.forEach(p => {
    const isActive = Boolean(active) && p.panelId === active.panelId;
    p.element.hidden = full ? !isActive : false;
    p.element.classList.toggle('workspace__panel--maximized', full && isActive);

    p.element.querySelector('[data-action="full-screen"]')
      ?.classList.toggle('panel-header__btn--active', full && isActive);
    p.element.querySelector('[data-action="split-screen"]')
      ?.classList.toggle('panel-header__btn--active', !full);
  });

  host.querySelectorAll('.workspace__divider').forEach(d => { d.hidden = full; });

  renderTabs();

  // Keep the dock's highlight in sync with whichever window is in front.
  EventBus.emit('app:focus', { appId: active ? active.appId : null });
}

/** Rebuild the window switcher strip (shown only in the full layout, >1 window). */
function renderTabs() {
  if (!tabsEl) return;

  const show = layout === 'full' && panels.length > 1;
  tabsEl.hidden = !show;
  if (!show) { tabsEl.innerHTML = ''; return; }

  tabsEl.innerHTML = panels.map(p => {
    const meta = APP_REGISTRY[p.appId] || { title: p.appId, icon: 'document' };
    const on = p.panelId === activePanelId;
    return `
      <div class="workspace__tab ${on ? 'workspace__tab--active' : ''}" data-panel-id="${escapeHtml(p.panelId)}">
        <button type="button" class="workspace__tab-main" data-tab-panel="${escapeHtml(p.panelId)}"
                title="${escapeHtml(meta.title)}" ${on ? 'aria-current="page"' : ''}>
          ${iconImg(meta.icon, { size: 15, alt: '', className: 'workspace__tab-icon' })}
          <span class="workspace__tab-text">${escapeHtml(meta.title)}</span>
        </button>
        <button type="button" class="workspace__tab-close" data-tab-close="${escapeHtml(p.panelId)}"
                title="Fermer ce volet" aria-label="Fermer ${escapeHtml(meta.title)}">
          ${iconImg('close-window', { size: 12, alt: '' })}
        </button>
      </div>`;
  }).join('');

  tabsEl.querySelectorAll('[data-tab-panel]').forEach(btn => {
    btn.addEventListener('click', () => setLayout('full', btn.dataset.tabPanel));
  });
  tabsEl.querySelectorAll('[data-tab-close]').forEach(btn => {
    btn.addEventListener('click', () => closePanel(btn.dataset.tabClose));
  });
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
  panels = [];
  layout = 'full';
  activePanelId = null;
  tabsEl = null;
  host = null;
  if (root) { root.innerHTML = ''; root = null; }
}
