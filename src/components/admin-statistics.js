/**
 * Fiches & Cloud — admin "Statistics" app.
 *
 * Aggregates the whole project into an at-a-glance dashboard: note/link counts,
 * total stored character volume, active-user count and a per-subject breakdown.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { iconImg } from '../app.js';

const state = {
  container: null,
  stats: null,
  loading: false
};

/** @param {HTMLElement} container */
export async function render(container) {
  state.container = container;
  container.classList.add('admin-container');

  container.innerHTML = `
    <div class="admin-app">
      <div class="admin-app__header">
        <div class="admin-app__title">
          ${iconImg('combo-chart', { size: 24, alt: '' })}
          <h2>Statistiques</h2>
          <span class="badge badge--admin">Admin</span>
        </div>
        <button class="btn btn--secondary" id="as-refresh">${iconImg('refresh', { size: 16, alt: '' })}<span>Actualiser</span></button>
      </div>

      <div class="admin-app__body" id="as-body">
        <div class="loading-block"><span class="spinner"></span><p>Calcul des métriques…</p></div>
      </div>
    </div>
  `;

  container.querySelector('#as-refresh')?.addEventListener('click', load);
  await load();
}

async function load() {
  const body = state.container?.querySelector('#as-body');
  if (!body || state.loading) return;

  state.loading = true;
  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Calcul des métriques…</p></div>`;

  try {
    const stats = await FirestoreService.getStats();
    state.stats = stats;
    renderDashboard(body, stats);
  } catch (err) {
    console.error('[Stats] load failed:', err);
    body.innerHTML = `
      <div class="empty-state">
        ${iconImg('high-priority', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">Statistiques indisponibles</h3>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="as-retry">Réessayer</button>
      </div>`;
    body.querySelector('#as-retry')?.addEventListener('click', load);
  } finally {
    state.loading = false;
  }
}

function renderDashboard(body, stats) {
  const { totalNotes, totalLinks, totalShortcuts, totalChars, activeUsers, subjectBreakdown } = stats;
  const avgChars = totalNotes > 0 ? Math.round(totalChars / totalNotes) : 0;
  const subjectCount = Object.keys(subjectBreakdown).length;

  const card = (icon, value, label, sub) => `
    <div class="stat-card">
      ${iconImg(icon, { size: 32, alt: '', className: 'stat-card__icon' })}
      <div class="stat-card__value">${value}</div>
      <div class="stat-card__label">${label}</div>
      ${sub ? `<div class="stat-card__sub">${sub}</div>` : ''}
    </div>`;

  const subjects = Object.entries(subjectBreakdown).sort((a, b) => b[1] - a[1]);
  const maxCount = subjects.reduce((max, [, c]) => Math.max(max, c), 0) || 1;

  const breakdown = subjects.length === 0
    ? `<div class="empty-state empty-state--inline">
         <p class="empty-state__description">Aucune fiche classée par matière pour le moment.</p>
       </div>`
    : `<div class="subject-bars">
        ${subjects.map(([subject, count]) => `
          <div class="subject-bar">
            <div class="subject-bar__head">
              <span class="subject-bar__label">${escapeHtml(subject)}</span>
              <span class="subject-bar__count">${count} fiche${count > 1 ? 's' : ''}</span>
            </div>
            <div class="subject-bar__track">
              <div class="subject-bar__fill" style="width:${Math.round((count / maxCount) * 100)}%"></div>
            </div>
          </div>`).join('')}
      </div>`;

  body.innerHTML = `
    <div class="stats-grid">
      ${card('document', totalNotes.toLocaleString('fr-FR'), 'Fiches', `${avgChars.toLocaleString('fr-FR')} car. en moyenne`)}
      ${card('link', totalLinks.toLocaleString('fr-FR'), 'Liens enregistrés', null)}
      ${card('bookmark', totalShortcuts.toLocaleString('fr-FR'), 'Raccourcis', null)}
      ${card('clock', totalChars.toLocaleString('fr-FR'), 'Caractères stockés', 'Volume total du projet')}
      ${card('group', activeUsers.toLocaleString('fr-FR'), 'Utilisateurs actifs', 'Connexion < 30 jours')}
      ${card('combo-chart', subjectCount.toLocaleString('fr-FR'), 'Matières', 'Répartition ci-dessous')}
    </div>

    <div class="admin-app__section">
      <h3>Répartition par matière</h3>
      ${breakdown}
    </div>

    <p class="admin-app__footnote">
      Métriques calculées en direct depuis Firestore à l'ouverture de cette application.
    </p>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tear down. */
export function destroy() {
  state.container = null;
  state.stats = null;
}
