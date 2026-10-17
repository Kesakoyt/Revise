/**
 * Fiches & Cloud — Central Workspace Manager
 * Coordinates multi-panel workspaces (up to 3 panels), dynamic module loading,
 * panel headers with maximize/close controls, and the welcome empty state.
 */

import { EventBus, AppState, showToast } from '../app.js';
import * as splitScreen from './split-screen.js';

let hostContainer = null;
let activePanels = []; // Array of { panelId, appId, params, panelElement, contentEl, moduleInstance, isMaximized }

let boundOnAppOpen = null;
let boundOnPanelClose = null;
let boundOnLogout = null;

// Registry of supported applications and their module paths
const APP_REGISTRY = {
  'file-explorer': {
    title: 'Explorateur de fiches',
    icon: 'folder',
    modulePath: './file-explorer.js'
  },
  'link-manager': {
    title: 'Gestionnaire de liens',
    icon: 'link',
    modulePath: './link-manager.js'
  },
  'markdown-editor': {
    title: 'Éditeur Markdown',
    icon: 'document',
    modulePath: './markdown-editor.js'
  },
  'admin-database': {
    title: 'Administration Base de données',
    icon: 'database',
    modulePath: './admin-database.js'
  },
  'admin-users': {
    title: 'Gestion des Utilisateurs',
    icon: 'group',
    modulePath: './admin-users.js'
  },
  'admin-statistics': {
    title: 'Statistiques & Métriques',
    icon: 'combo-chart',
    modulePath: './admin-statistics.js'
  }
};

/**
 * Render the workspace within the specified container
 * @param {HTMLElement} container 
 */
export function render(container) {
  hostContainer = container;
  container.innerHTML = '';
  activePanels = [];

  // Initialize layout container
  splitScreen.createLayout(container, 0);

  // Show welcome empty state initially
  renderEmptyState();

  // Attach EventBus listeners
  boundOnAppOpen = ({ appId, params }) => {
    openPanel(appId, params);
  };

  boundOnPanelClose = ({ panelId }) => {
    closePanel(panelId);
  };

  boundOnLogout = () => {
    closeAllPanels();
  };

  EventBus.on('app:open', boundOnAppOpen);
  EventBus.on('panel:close', boundOnPanelClose);
  EventBus.on('auth:logout', boundOnLogout);
}

/**
 * Open an application in a workspace panel
 * @param {string} appId - Identifier matching APP_REGISTRY
 * @param {Object} [params={}] - Parameters passed to the component module
 * @returns {Promise<string|null>} The panelId or null if blocked
 */
export async function openPanel(appId, params = {}) {
  if (!hostContainer) return null;

  const appMeta = APP_REGISTRY[appId];
  if (!appMeta) {
    console.error(`[Workspace] Unknown application id: "${appId}"`);
    showToast(`Application inconnue : ${appId}`, 'error');
    return null;
  }

  // Check if panel with this appId is already open
  const existingPanel = activePanels.find(p => p.appId === appId);
  if (existingPanel) {
    // If different params supplied (e.g., editing a specific note)
    if (params && Object.keys(params).length > 0 && existingPanel.moduleInstance?.render) {
      existingPanel.params = params;
      try {
        existingPanel.moduleInstance.render(existingPanel.contentEl, params);
      } catch (err) {
        console.error(`[Workspace] Error re-rendering ${appId}:`, err);
      }
    }
    focusPanel(existingPanel);
    return existingPanel.panelId;
  }

  // Enforce maximum 3 panels
  if (activePanels.length >= 3) {
    showToast('Limite de 3 volets atteinte. Veuillez fermer un volet pour en ouvrir un nouveau.', 'info');
    return null;
  }

  // Remove empty state if present
  clearEmptyState();

  // Create panel element through split-screen utility
  const panelElement = splitScreen.addPanel(hostContainer);
  if (!panelElement) {
    showToast('Impossible d\'ajouter un volet supplémentaire.', 'error');
    return null;
  }

  const panelId = `panel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  panelElement.setAttribute('data-panel-id', panelId);
  panelElement.setAttribute('data-app-id', appId);

  // Construct Header Bar
  const header = document.createElement('header');
  header.className = 'panel-header';
  header.innerHTML = `
    <div class="panel-header__title">
      <img src="https://img.icons8.com/fluency/20/${appMeta.icon}.png" alt="" width="20" height="20" class="panel-header__icon">
      <span class="panel-header__text">${appMeta.title}</span>
    </div>
    <div class="panel-header__actions">
      <button type="button" class="btn btn--icon panel-header__btn panel-header__btn--maximize" title="Agrandir / Réduire" aria-label="Agrandir le volet">
        <img src="https://img.icons8.com/fluency/18/full-screen.png" alt="Agrandir" width="16" height="16">
      </button>
      <button type="button" class="btn btn--icon panel-header__btn panel-header__btn--close" title="Fermer le volet" aria-label="Fermer le volet">
        <img src="https://img.icons8.com/fluency/18/close-window.png" alt="Fermer" width="16" height="16">
      </button>
    </div>
  `;

  // Content Area
  const contentEl = document.createElement('div');
  contentEl.className = 'workspace__panel-content';
  contentEl.style.flex = '1';
  contentEl.style.overflow = 'auto';
  contentEl.style.position = 'relative';

  panelElement.appendChild(header);
  panelElement.appendChild(contentEl);

  const panelRecord = {
    panelId,
    appId,
    params,
    panelElement,
    contentEl,
    moduleInstance: null,
    isMaximized: false
  };

  // Attach Header Actions
  const maxBtn = header.querySelector('.panel-header__btn--maximize');
  const closeBtn = header.querySelector('.panel-header__btn--close');

  maxBtn?.addEventListener('click', () => toggleMaximize(panelRecord));
  closeBtn?.addEventListener('click', () => closePanel(panelId));

  // Dynamically load the component module
  contentEl.innerHTML = `
    <div class="panel-loading" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--fluent-text-secondary);">
      <span>Chargement de ${appMeta.title}...</span>
    </div>
  `;

  try {
    const compModule = await import(appMeta.modulePath);
    contentEl.innerHTML = '';
    compModule.render(contentEl, params);
    panelRecord.moduleInstance = compModule;
  } catch (err) {
    console.error(`[Workspace] Failed to import or render module for ${appId}:`, err);
    contentEl.innerHTML = `
      <div class="card" style="margin:20px;padding:20px;text-align:center;">
        <p style="color:#d13438;font-weight:600;margin-bottom:8px;">Erreur de chargement</p>
        <p style="color:var(--fluent-text-secondary);font-size:13px;">Impossible d'initialiser ${appMeta.title}.</p>
      </div>
    `;
    showToast(`Erreur de chargement pour ${appMeta.title}`, 'error');
  }

  activePanels.push(panelRecord);
  return panelId;
}

/**
 * Close an active panel by identifier
 * @param {string} panelId 
 */
export function closePanel(panelId) {
  const index = activePanels.findIndex(p => p.panelId === panelId);
  if (index === -1) return;

  const panel = activePanels[index];

  // If panel was maximized, restore other elements first
  if (panel.isMaximized) {
    toggleMaximize(panel);
  }

  // Cleanup component module
  try {
    if (typeof panel.moduleInstance?.destroy === 'function') {
      panel.moduleInstance.destroy();
    }
  } catch (err) {
    console.error(`[Workspace] Error destroying module for ${panel.appId}:`, err);
  }

  // Remove element and dividers
  splitScreen.removePanel(hostContainer, panel.panelElement);
  activePanels.splice(index, 1);

  // Notify listeners
  EventBus.emit('panel:close', { panelId });

  // Show empty state if no panels remain
  if (activePanels.length === 0) {
    renderEmptyState();
  }
}

/**
 * Close all active panels (e.g., during logout)
 */
function closeAllPanels() {
  const panelsToClose = [...activePanels];
  panelsToClose.forEach(p => closePanel(p.panelId));
}

/**
 * Focus and visually highlight an already open panel
 * @param {Object} panel 
 */
function focusPanel(panel) {
  panel.panelElement.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  panel.panelElement.classList.add('workspace__panel--focused');
  setTimeout(() => {
    panel.panelElement.classList.remove('workspace__panel--focused');
  }, 800);
}

/**
 * Toggle maximize/restore state for a panel
 * @param {Object} panel 
 */
function toggleMaximize(panel) {
  panel.isMaximized = !panel.isMaximized;

  const maxBtnImg = panel.panelElement.querySelector('.panel-header__btn--maximize img');

  if (panel.isMaximized) {
    panel.panelElement.classList.add('workspace__panel--maximized');
    if (maxBtnImg) {
      maxBtnImg.src = 'https://img.icons8.com/fluency/18/collapse.png';
      maxBtnImg.alt = 'Réduire';
    }
    // Hide other panels and dividers
    activePanels.forEach(p => {
      if (p.panelId !== panel.panelId) {
        p.panelElement.style.display = 'none';
      }
    });
    hostContainer?.querySelectorAll('.workspace__divider').forEach(d => {
      d.style.display = 'none';
    });
  } else {
    panel.panelElement.classList.remove('workspace__panel--maximized');
    if (maxBtnImg) {
      maxBtnImg.src = 'https://img.icons8.com/fluency/18/full-screen.png';
      maxBtnImg.alt = 'Agrandir';
    }
    // Restore other panels and dividers
    activePanels.forEach(p => {
      p.panelElement.style.display = 'flex';
    });
    hostContainer?.querySelectorAll('.workspace__divider').forEach(d => {
      d.style.display = 'block';
    });
  }
}

/**
 * Render the welcome / empty state dashboard when no panels are active
 */
function renderEmptyState() {
  if (!hostContainer) return;
  if (hostContainer.querySelector('.empty-state')) return;

  const isAdmin = Boolean(AppState.isAdmin || AppState.profile?.role === 'admin');

  const emptyStateEl = document.createElement('div');
  emptyStateEl.className = 'empty-state';
  emptyStateEl.innerHTML = `
    <div class="empty-state__card card">
      <img src="https://img.icons8.com/fluency/64/cloud-checked.png" alt="Fiches & Cloud" class="empty-state__icon" width="64" height="64">
      <h2 class="empty-state__title">Bienvenue dans Fiches & Cloud</h2>
      <p class="empty-state__description">
        Votre espace de révision connecté. Consultez vos cours, écrivez de nouvelles fiches en Markdown avec KaTeX, ou organisez vos ressources.
      </p>

      <div class="empty-state__grid">
        <button type="button" class="empty-state__action-card card" id="btn-quick-explorer">
          <img src="https://img.icons8.com/fluency/32/folder.png" alt="" width="32" height="32">
          <span class="empty-state__action-title">Explorateur</span>
          <span class="empty-state__action-desc">Parcourir toutes les fiches</span>
        </button>

        <button type="button" class="empty-state__action-card card" id="btn-quick-editor">
          <img src="https://img.icons8.com/fluency/32/document.png" alt="" width="32" height="32">
          <span class="empty-state__action-title">Nouvelle fiche</span>
          <span class="empty-state__action-desc">Rédiger en Markdown + Math</span>
        </button>

        <button type="button" class="empty-state__action-card card" id="btn-quick-links">
          <img src="https://img.icons8.com/fluency/32/link.png" alt="" width="32" height="32">
          <span class="empty-state__action-title">Liens utiles</span>
          <span class="empty-state__action-desc">Vos favoris et ressources web</span>
        </button>

        ${isAdmin ? `
          <button type="button" class="empty-state__action-card card" id="btn-quick-stats">
            <img src="https://img.icons8.com/fluency/32/combo-chart.png" alt="" width="32" height="32">
            <span class="empty-state__action-title">Statistiques</span>
            <span class="empty-state__action-desc">Métriques d'administration</span>
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Attach click actions to quick launch cards
  emptyStateEl.querySelector('#btn-quick-explorer')?.addEventListener('click', () => openPanel('file-explorer'));
  emptyStateEl.querySelector('#btn-quick-editor')?.addEventListener('click', () => openPanel('markdown-editor'));
  emptyStateEl.querySelector('#btn-quick-links')?.addEventListener('click', () => openPanel('link-manager'));
  emptyStateEl.querySelector('#btn-quick-stats')?.addEventListener('click', () => openPanel('admin-statistics'));

  hostContainer.appendChild(emptyStateEl);
}

/**
 * Remove empty state element if present
 */
function clearEmptyState() {
  if (!hostContainer) return;
  const emptyState = hostContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
}

/**
 * Destroy workspace, close all active panels and remove event listeners
 */
export function destroy() {
  closeAllPanels();

  if (boundOnAppOpen) EventBus.off('app:open', boundOnAppOpen);
  if (boundOnPanelClose) EventBus.off('panel:close', boundOnPanelClose);
  if (boundOnLogout) EventBus.off('auth:logout', boundOnLogout);

  boundOnAppOpen = null;
  boundOnPanelClose = null;
  boundOnLogout = null;

  if (hostContainer) {
    hostContainer.innerHTML = '';
    hostContainer = null;
  }
}
