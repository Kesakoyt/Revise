/**
 * Fiches & Cloud — Link Manager.
 *
 * Curates external resources (title, URL, description, subject) with search,
 * subject filtering and full CRUD.
 */

import { FirestoreService } from '../services/firestore-service.js';
import { EventBus, AppState, showToast, iconImg } from '../app.js';

const state = {
  container: null,
  links: [],
  subjects: [],
  subject: 'all',
  query: '',
  editingId: null,
  handlers: []
};

/** @param {HTMLElement} container */
export async function render(container, params = {}) {
  state.container = container;
  container.classList.add('link-manager-container');

  container.innerHTML = `
    <div class="link-manager">
      <div class="link-manager__header">
        <h2 class="link-manager__title">${iconImg('link', { size: 24, alt: '' })}Mes liens</h2>
        <button class="btn btn--primary" id="lm-add">${iconImg('add', { size: 18, alt: '' })}<span>Ajouter un lien</span></button>
      </div>

      <div class="card link-manager__form-card" id="lm-form-card" hidden>
        <div class="link-manager__form-head">
          <h3 id="lm-form-title">Nouveau lien</h3>
          <button type="button" class="btn btn--icon" id="lm-form-close" aria-label="Fermer">&times;</button>
        </div>
        <form class="link-manager__form" id="lm-form" novalidate>
          <div class="form-grid">
            <div class="form-group form-group--wide">
              <label class="form-label" for="lm-url">URL <span class="required">*</span></label>
              <input class="input" type="url" id="lm-url" placeholder="https://exemple.fr/article" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="lm-title">Titre <span class="required">*</span></label>
              <input class="input" type="text" id="lm-title" placeholder="Nom de la ressource" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="lm-subject">Matière</label>
              <input class="input" type="text" id="lm-subject" list="lm-subjects" placeholder="ex : Informatique">
              <datalist id="lm-subjects"></datalist>
            </div>
            <div class="form-group form-group--wide">
              <label class="form-label" for="lm-desc">Description (facultatif)</label>
              <textarea class="textarea" id="lm-desc" rows="2" placeholder="Résumé ou note personnelle…"></textarea>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn--secondary" id="lm-form-cancel">Annuler</button>
            <button type="submit" class="btn btn--primary">${iconImg('save', { size: 16, alt: '' })}<span id="lm-save-label">Enregistrer</span></button>
          </div>
        </form>
      </div>

      <div class="link-manager__toolbar">
        <div class="search-field">
          ${iconImg('search', { size: 18, alt: '', className: 'search-field__icon' })}
          <input type="text" class="input input--search" id="lm-search" placeholder="Rechercher un lien…" value="${escapeAttr(state.query)}">
        </div>
        <select class="input select" id="lm-filter" aria-label="Filtrer par matière">
          <option value="all">Toutes les matières</option>
        </select>
      </div>

      <div class="link-manager__body" id="lm-body">
        <div class="loading-block"><span class="spinner"></span><p>Chargement des liens…</p></div>
      </div>
    </div>
  `;

  bindForm();
  bindToolbar();
  bindBus();
  await loadLinks();
  if (params?.newLink) {
    openForm();
  }
}

async function loadLinks() {
  const body = state.container?.querySelector('#lm-body');
  if (!body) return;

  const uid = AppState.user?.uid;
  if (!uid) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Connexion requise</p>
        <p class="empty-state__description">Connectez-vous pour gérer vos liens.</p>
      </div>`;
    return;
  }

  body.innerHTML = `<div class="loading-block"><span class="spinner"></span><p>Chargement des liens…</p></div>`;

  try {
    state.links = await FirestoreService.getUserLinks(uid, {});
    const subjects = new Set();
    state.links.forEach(l => { if (l.subject?.trim()) subjects.add(l.subject.trim()); });
    state.subjects = [...subjects].sort();

    updateSubjectControls();
    renderLinks();
  } catch (err) {
    console.error('[Links] load failed:', err);
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Chargement impossible</p>
        <p class="empty-state__description">${escapeHtml(err.message)}</p>
        <button class="btn btn--secondary" id="lm-retry">Réessayer</button>
      </div>`;
    body.querySelector('#lm-retry')?.addEventListener('click', loadLinks);
  }
}

function updateSubjectControls() {
  const filter = state.container?.querySelector('#lm-filter');
  const datalist = state.container?.querySelector('#lm-subjects');
  if (filter) {
    filter.innerHTML = '<option value="all">Toutes les matières</option>' +
      state.subjects.map(s => `<option value="${escapeAttr(s)}" ${state.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }
  if (datalist) {
    datalist.innerHTML = state.subjects.map(s => `<option value="${escapeAttr(s)}"></option>`).join('');
  }
}

function bindToolbar() {
  const c = state.container;
  const search = c.querySelector('#lm-search');
  let timer = null;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    state.query = search.value.trim().toLowerCase();
    timer = setTimeout(renderLinks, 220);
  });
  c.querySelector('#lm-filter')?.addEventListener('change', e => { state.subject = e.target.value; renderLinks(); });
  c.querySelector('#lm-add')?.addEventListener('click', () => openForm());
}

function bindForm() {
  const c = state.container;
  c.querySelector('#lm-form-close')?.addEventListener('click', closeForm);
  c.querySelector('#lm-form-cancel')?.addEventListener('click', closeForm);
  c.querySelector('#lm-form')?.addEventListener('submit', e => { e.preventDefault(); submitForm(); });
}

function openForm(link = null) {
  const c = state.container;
  state.editingId = link?.id || null;
  c.querySelector('#lm-form-title').textContent = link ? 'Modifier le lien' : 'Nouveau lien';
  c.querySelector('#lm-save-label').textContent = link ? 'Mettre à jour' : 'Enregistrer';
  c.querySelector('#lm-url').value = link?.url || '';
  c.querySelector('#lm-title').value = link?.title || '';
  c.querySelector('#lm-subject').value = link?.subject || '';
  c.querySelector('#lm-desc').value = link?.description || '';
  c.querySelector('#lm-form-card').hidden = false;
  c.querySelector('#lm-url').focus();
}

function closeForm() {
  state.editingId = null;
  const card = state.container?.querySelector('#lm-form-card');
  if (card) card.hidden = true;
}

async function submitForm() {
  const c = state.container;
  let url = c.querySelector('#lm-url').value.trim();
  const title = c.querySelector('#lm-title').value.trim();
  const subject = c.querySelector('#lm-subject').value.trim() || 'Général';
  const description = c.querySelector('#lm-desc').value.trim();

  if (!url) { showToast('Veuillez saisir une URL.', 'error'); c.querySelector('#lm-url').focus(); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try { new URL(url); }
  catch { showToast('Adresse URL invalide.', 'error'); c.querySelector('#lm-url').focus(); return; }

  if (!title) { showToast('Veuillez saisir un titre.', 'error'); c.querySelector('#lm-title').focus(); return; }

  const uid = AppState.user?.uid;
  if (!uid) { showToast('Connectez-vous pour enregistrer.', 'error'); return; }

  try {
    if (state.editingId) {
      await FirestoreService.updateLink(state.editingId, { title, url, description, subject });
      FirestoreService.logAccess({ uid, documentId: state.editingId, documentType: 'link', action: 'edit' });
      EventBus.emit('link:saved', { linkId: state.editingId });
      showToast('Lien mis à jour.', 'success');
    } else {
      const id = await FirestoreService.createLink({ uid, title, url, description, subject });
      FirestoreService.logAccess({ uid, documentId: id, documentType: 'link', action: 'create' });
      EventBus.emit('link:saved', { linkId: id });
      showToast('Lien ajouté.', 'success');
    }
    closeForm();
    await loadLinks();
  } catch (err) {
    console.error('[Links] save failed:', err);
    showToast(`Enregistrement échoué : ${err.message}`, 'error');
  }
}

function renderLinks() {
  const body = state.container?.querySelector('#lm-body');
  if (!body) return;

  const filtered = state.links.filter(link => {
    if (state.subject !== 'all' && (link.subject || '').trim() !== state.subject) return false;
    if (!state.query) return true;
    const q = state.query;
    return ['title', 'url', 'description', 'subject'].some(k => (link[k] || '').toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    const searching = Boolean(state.query) || state.subject !== 'all';
    body.innerHTML = `
      <div class="empty-state">
        ${iconImg('link', { size: 48, alt: '', className: 'empty-state__icon' })}
        <h3 class="empty-state__title">${searching ? 'Aucun lien ne correspond' : 'Aucun lien enregistré'}</h3>
        <p class="empty-state__description">${searching ? 'Effacez la recherche ou le filtre.' : 'Enregistrez des pages web, de la documentation et des références.'}</p>
        ${searching ? '' : `<button class="btn btn--primary" id="lm-empty-add">${iconImg('add', { size: 18, alt: '' })}<span>Ajouter un lien</span></button>`}
      </div>`;
    body.querySelector('#lm-empty-add')?.addEventListener('click', () => openForm());
    return;
  }

  body.innerHTML = `<div class="links-grid">${filtered.map(linkCard).join('')}</div>`;

  body.querySelectorAll('.link-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-edit') || e.target.closest('.btn-delete') || e.target.closest('a')) return;
      if (card.dataset.url) window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
    });
  });
  body.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const link = state.links.find(l => l.id === btn.dataset.id);
      if (link) openForm(link);
    });
  });
  body.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteLink(btn.dataset.id); });
  });
}

function linkCard(link) {
  let domain = 'externe';
  try { domain = new URL(link.url).hostname.replace(/^www\./, ''); } catch { /* keep default */ }

  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;

  return `
    <article class="link-card" data-url="${escapeAttr(link.url)}">
      <div class="link-card__head">
        <img class="link-card__favicon" src="${favicon}" alt="" width="32" height="32"
             onerror="this.onerror=null;this.src='${iconImgUrl('link')}'">
        <div class="link-card__title-wrap">
          <h4 class="link-card__title">${escapeHtml(link.title || 'Sans titre')}</h4>
          <span class="link-card__domain">${escapeHtml(domain)}</span>
        </div>
        <span class="badge badge--subject">${escapeHtml(link.subject || 'Général')}</span>
      </div>

      ${link.description
        ? `<p class="link-card__desc">${escapeHtml(link.description)}</p>`
        : '<div class="link-card__spacer"></div>'}

      <div class="link-card__footer">
        <a class="link-card__url" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(link.url)}">
          <span>${escapeHtml(truncate(link.url, 42))}</span>
          ${iconImg('external-link', { size: 14, alt: '' })}
        </a>
        <div class="link-card__actions">
          <button class="btn btn--icon btn-edit" data-id="${link.id}" title="Modifier" aria-label="Modifier">${iconImg('edit', { size: 16, alt: '' })}</button>
          <button class="btn btn--icon btn--danger btn-delete" data-id="${link.id}" title="Supprimer" aria-label="Supprimer">${iconImg('delete', { size: 16, alt: '' })}</button>
        </div>
      </div>
    </article>`;
}

async function deleteLink(id) {
  const link = state.links.find(l => l.id === id);
  if (!confirm(`Supprimer « ${link?.title || 'ce lien'} » ?`)) return;

  try {
    showToast('Suppression…', 'info');
    const uid = AppState.user?.uid;
    await FirestoreService.deleteLink(id);
    if (uid) FirestoreService.logAccess({ uid, documentId: id, documentType: 'link', action: 'delete' });

    state.links = state.links.filter(l => l.id !== id);
    EventBus.emit('link:deleted', { linkId: id });
    showToast('Lien supprimé.', 'success');
    renderLinks();
  } catch (err) {
    console.error('[Links] delete failed:', err);
    showToast(`Suppression échouée : ${err.message}`, 'error');
  }
}

function bindBus() {
  const onSaved = () => loadLinks();
  const onDeleted = () => loadLinks();
  EventBus.on('link:saved', onSaved);
  EventBus.on('link:deleted', onDeleted);
  state.handlers.push(['link:saved', onSaved], ['link:deleted', onDeleted]);
}

function iconImgUrl(name) {
  return `https://img.icons8.com/fluency/200/${name}.png`;
}
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) { return escapeHtml(str); }
function truncate(str, max = 40) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Tear down. */
export function destroy() {
  state.handlers.forEach(([ev, fn]) => EventBus.off(ev, fn));
  state.handlers = [];
  state.container = null;
  state.links = [];
}
