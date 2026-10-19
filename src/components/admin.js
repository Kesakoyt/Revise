/**
 * Fiches & Cloud — Administration shell.
 *
 * One app hosting every admin tool behind a left sidebar (the "side options"):
 * Base de données, Fichiers publics, Utilisateurs, Partages and Statistiques.
 * Each section is an existing module mounted into the content pane; the shell
 * deliberately knows very little about them, so a section can be added or
 * reordered by editing {@link SECTIONS} alone.
 *
 * `openPanel('admin', { section })` — or any legacy `admin-*` app id, which
 * `workspace.js` maps back to a section — opens it straight on that section.
 */

import { iconImg } from '../app.js';
import { FirestoreService } from '../services/firestore-service.js';

/** Sidebar entries, in display order. `data` marks the modules needing the
 *  admin collections pre-loaded (they don't fetch on their own). */
const SECTIONS = [
  { id: 'database',   icon: 'database',      label: 'Base de données', modulePath: './admin-database.js' },
  { id: 'public',     icon: 'opened-folder', label: 'Fichiers publics', modulePath: './admin-public-files.js', data: true },
  { id: 'users',      icon: 'group',         label: 'Utilisateurs',    modulePath: './admin-users.js' },
  { id: 'shares',     icon: 'share',         label: 'Partages',        modulePath: './admin-shares.js' },
  { id: 'statistics', icon: 'combo-chart',   label: 'Statistiques',    modulePath: './admin-statistics.js' }
];

const state = {
  container: null,
  section: 'database',
  module: null
};

/**
 * @param {HTMLElement} container
 * @param {{section?:string}} [params]
 */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('admin-container');

  state.section = SECTIONS.some(s => s.id === params.section) ? params.section : 'database';

  container.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-shell__nav" aria-label="Sections d'administration">
        <div class="admin-shell__brand">
          ${iconImg('database', { size: 20, alt: '', className: 'admin-shell__brand-icon' })}
          <span class="admin-shell__brand-label">Administration</span>
          <span class="badge badge--admin">Admin</span>
        </div>
        <nav class="admin-shell__list">
          ${SECTIONS.map(sectionButton).join('')}
        </nav>
      </aside>

      <div class="admin-shell__content" id="admin-content"></div>
    </div>
  `;

  container.querySelectorAll('[data-admin-section]').forEach(btn => {
    btn.addEventListener('click', () => selectSection(btn.dataset.adminSection));
  });

  await mountSection();
}

function sectionButton(section) {
  const active = state.section === section.id;
  return `
    <button type="button"
            class="admin-shell__item ${active ? 'admin-shell__item--active' : ''}"
            data-admin-section="${section.id}"
            ${active ? 'aria-current="page"' : ''}>
      ${iconImg(section.icon, { size: 18, alt: '', className: 'admin-shell__icon' })}
      <span class="admin-shell__label">${section.label}</span>
    </button>`;
}

/** Switch sections: tear the previous module down, then mount the new one. */
async function selectSection(id) {
  if (!SECTIONS.some(s => s.id === id) || id === state.section) return;
  state.section = id;

  const c = state.container;
  c?.querySelectorAll('[data-admin-section]').forEach(btn => {
    const active = btn.dataset.adminSection === id;
    btn.classList.toggle('admin-shell__item--active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  await mountSection();
}

/** Load the active section module into the content pane. */
async function mountSection() {
  const content = state.container?.querySelector('#admin-content');
  if (!content) return;

  // Always tear the previous section down: a section may hold listeners or a
  // context menu that must not survive the switch.
  try { state.module?.destroy?.(); } catch (err) { console.warn('[Admin] section destroy failed:', err); }
  state.module = null;

  const section = SECTIONS.find(s => s.id === state.section);
  content.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement…</p></div>`;

  try {
    const module = await import(section.modulePath);
    state.module = module;
    content.innerHTML = '';

    if (section.data) {
      const data = await loadCollections(section.id);
      module.render(content, data);
    } else {
      await module.render(content, {});
    }
  } catch (err) {
    console.error(`[Admin] failed to load section "${section.id}":`, err);
    content.innerHTML = `
      <div class="empty-state">
        ${iconImg('high-priority', { size: 40, alt: '' })}
        <h3 class="empty-state__title">Section indisponible</h3>
        <p class="empty-state__description">${err.message}</p>
      </div>`;
  }
}

/**
 * Everything a data-hungry section needs, loaded in one resilient batch.
 * @param {string} sectionId
 */
async function loadCollections(sectionId) {
  const safe = p => p.catch(err => { console.warn('[Admin] collection failed:', err); return []; });

  if (sectionId === 'public') {
    const [folders, notes, links, users] = await Promise.all([
      safe(FirestoreService.getAllFolders()),
      safe(FirestoreService.getAllNotes()),
      safe(FirestoreService.getAllLinks()),
      safe(FirestoreService.getAllUsers())
    ]);

    const userMap = {};
    users.forEach(u => { userMap[u.id || u.uid] = u.displayName || u.email || `Utilisateur ${(u.id || u.uid).slice(0, 5)}`; });

    // A change inside the browser re-reads the collections and re-renders in
    // place, so the current folder stays put.
    const refresh = async () => {
      const el = state.container?.querySelector('#admin-content');
      if (!el || state.section !== 'public') return;
      const fresh = await loadCollections('public');
      state.module?.render(el, fresh);
    };

    return { folders, notes, links, userMap, query: '', onChanged: refresh };
  }

  return {};
}

/** Tear down the shell and the mounted section. */
export function destroy() {
  try { state.module?.destroy?.(); } catch (err) { console.warn('[Admin] section destroy failed:', err); }
  state.module = null;
  state.section = 'database';
  state.container = null;
}
