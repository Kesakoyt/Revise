/**
 * Fiches & Cloud — Context menu.
 *
 * A lightweight, Fluent-styled right-click menu with nested submenus, keyboard
 * navigation and viewport clamping. Fully self-contained: the caller supplies a
 * plain array of item descriptors and the component owns placement, focus and
 * dismissal.
 *
 * Item descriptor:
 *   {
 *     label?:    string,      // visible text (omit for a separator)
 *     icon?:     string,      // Icons8 Fluency slug
 *     shortcut?: string,      // right-aligned hint, e.g. "Ctrl+N"
 *     disabled?: boolean,
 *     danger?:   boolean,     // red styling (destructive actions)
 *     checked?:  boolean,     // radio/check state → shows a check mark
 *     separator?: boolean,    // render a horizontal rule instead of a row
 *     submenu?:  Item[],      // nested items → opens a submenu
 *     onSelect?: Function     // invoked when the row is activated
 *   }
 */

import { iconImg } from '../app.js';

const BASE = 'context-menu';

/** @typedef {Object} MenuItem */
/** @type {HTMLElement[]} */
let openMenus = [];
let submenuTimer = null;
let globalsBound = false;

const onGlobalPointerDown = e => {
  if (openMenus.some(m => m.contains(e.target))) return;
  closeContextMenu();
};
const onGlobalContextMenu = () => closeContextMenu();
const onGlobalClose = () => closeContextMenu();
const onGlobalKeyDown = handleKeyDown;

/**
 * Open a context menu at viewport coordinates.
 * @param {number} x
 * @param {number} y
 * @param {MenuItem[]} items
 * @returns {HTMLElement} the root menu element
 */
export function showContextMenu(x, y, items) {
  closeContextMenu();

  const menu = createMenu(items, 0);
  document.body.appendChild(menu);
  openMenus.push(menu);

  positionAt(menu, x, y, x, y);
  bindGlobals();

  // Focus the first actionable row so the menu is keyboard-drivable.
  menu.querySelector(`.${BASE}__item:not([disabled])`)?.focus({ preventScroll: true });
  return menu;
}

/** Close every open menu (root and submenus). */
export function closeContextMenu() {
  clearTimeout(submenuTimer);
  openMenus.forEach(m => m.remove());
  openMenus = [];
  unbindGlobals();
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * @param {MenuItem[]} items
 * @param {number} level 0 = root, 1+ = submenu depth
 * @returns {HTMLElement}
 */
function createMenu(items, level) {
  const menu = document.createElement('div');
  menu.className = `${BASE} ${BASE}--level-${level}`;
  menu.setAttribute('role', 'menu');
  menu._level = level;
  // The menu itself must never trigger the browser's native menu.
  menu.addEventListener('contextmenu', e => e.preventDefault());

  (items || []).forEach(item => {
    if (!item) return;
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = `${BASE}__separator`;
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      return;
    }
    menu.appendChild(createRow(item, level));
  });

  return menu;
}

/**
 * @param {MenuItem} item
 * @param {number} level
 * @returns {HTMLButtonElement}
 */
function createRow(item, level) {
  const row = document.createElement('button');
  row.type = 'button';
  row.tabIndex = -1;
  row.className = `${BASE}__item`;
  row.setAttribute('role', 'menuitem');

  if (item.disabled) {
    row.disabled = true;
    row.classList.add(`${BASE}__item--disabled`);
  }
  if (item.danger) row.classList.add(`${BASE}__item--danger`);
  if (item.checked) row.classList.add(`${BASE}__item--checked`);

  // Leading icon slot (a check mark wins when the row is "checked").
  const iconName = item.checked ? 'checkmark' : item.icon;
  const icon = document.createElement('span');
  icon.className = `${BASE}__icon`;
  if (iconName) icon.innerHTML = iconImg(iconName, { size: 16, alt: '' });
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = `${BASE}__label`;
  label.textContent = item.label || '';
  row.appendChild(label);

  if (item.shortcut) {
    const shortcut = document.createElement('span');
    shortcut.className = `${BASE}__shortcut`;
    shortcut.textContent = item.shortcut;
    row.appendChild(shortcut);
  }

  const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;

  if (hasSubmenu) {
    row.classList.add(`${BASE}__item--has-submenu`);
    row.setAttribute('aria-haspopup', 'menu');

    const arrow = document.createElement('span');
    arrow.className = `${BASE}__arrow`;
    arrow.textContent = '\u203A'; // ›
    arrow.setAttribute('aria-hidden', 'true');
    row.appendChild(arrow);

    row.addEventListener('mouseenter', () => {
      clearTimeout(submenuTimer);
      openSubmenu(row, item.submenu, level);
    });
    row.addEventListener('mouseleave', () => scheduleCloseSubmenu(row));
    row.addEventListener('click', e => {
      e.stopPropagation();
      if (row.disabled) return;
      openSubmenu(row, item.submenu, level);
    });
  } else if (!item.disabled) {
    // Hovering a leaf closes any sibling submenu, like the native menu.
    row.addEventListener('mouseenter', () => { clearTimeout(submenuTimer); closeSubmenus(); });
    row.addEventListener('click', e => {
      e.stopPropagation();
      closeContextMenu();
      if (typeof item.onSelect === 'function') item.onSelect();
    });
  }

  return row;
}

/**
 * Open (or re-open) the submenu attached to `row`.
 * @param {HTMLButtonElement} row
 * @param {MenuItem[]} items
 * @param {number} level
 */
function openSubmenu(row, items, level) {
  clearTimeout(submenuTimer);
  closeSubmenus();

  if (row._submenuEl) {
    row._submenuEl.remove();
    openMenus = openMenus.filter(m => m !== row._submenuEl);
  }

  const submenu = createMenu(items, level + 1);
  submenu._parentRow = row;
  submenu.style.visibility = 'hidden';
  document.body.appendChild(submenu);
  openMenus.push(submenu);

  row._submenuEl = submenu;
  submenu.addEventListener('mouseenter', () => clearTimeout(submenuTimer));
  submenu.addEventListener('mouseleave', () => scheduleCloseSubmenu(row));

  positionSubmenu(submenu, row);
  submenu.style.visibility = '';
  submenu.querySelector(`.${BASE}__item:not([disabled])`)?.focus({ preventScroll: true });
}

/** Close every submenu, clearing their parent-row back-references. */
function closeSubmenus() {
  openMenus = openMenus.filter(menu => {
    if (menu._level > 0) {
      if (menu._parentRow) menu._parentRow._submenuEl = null;
      menu.remove();
      return false;
    }
    return true;
  });
}

/**
 * Close the submenu of `row` after a short grace period so the pointer can
 * travel from the row into the submenu without it vanishing.
 * @param {HTMLButtonElement} row
 */
function scheduleCloseSubmenu(row) {
  clearTimeout(submenuTimer);
  submenuTimer = setTimeout(() => {
    if (!row._submenuEl) return;
    row._submenuEl.remove();
    openMenus = openMenus.filter(m => m !== row._submenuEl);
    row._submenuEl = null;
  }, 220);
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

/**
 * Position a menu, clamped to the viewport.
 * @param {HTMLElement} menu
 * @param {number} x @param {number} y
 */
function positionAt(menu, x, y) {
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;

  if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
  if (top + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/**
 * Position a submenu next to its parent row, flipping sides when needed.
 * @param {HTMLElement} submenu
 * @param {HTMLButtonElement} row
 */
function positionSubmenu(submenu, row) {
  const { innerWidth: vw, innerHeight: vh } = window;
  const rowRect = row.getBoundingClientRect();
  const rect = submenu.getBoundingClientRect();

  let left = rowRect.right - 4;
  if (left + rect.width > vw - 8) left = Math.max(8, rowRect.left - rect.width + 4);

  let top = rowRect.top - 6;
  if (top + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);

  submenu.style.left = `${Math.round(left)}px`;
  submenu.style.top = `${Math.round(top)}px`;
}

// ---------------------------------------------------------------------------
// Global listeners + keyboard
// ---------------------------------------------------------------------------

function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener('pointerdown', onGlobalPointerDown, true);
  document.addEventListener('contextmenu', onGlobalContextMenu);
  document.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('resize', onGlobalClose);
  window.addEventListener('blur', onGlobalClose);
  window.addEventListener('scroll', onGlobalClose, true);
}

function unbindGlobals() {
  if (!globalsBound) return;
  globalsBound = false;
  document.removeEventListener('pointerdown', onGlobalPointerDown, true);
  document.removeEventListener('contextmenu', onGlobalContextMenu);
  document.removeEventListener('keydown', onGlobalKeyDown);
  window.removeEventListener('resize', onGlobalClose);
  window.removeEventListener('blur', onGlobalClose);
  window.removeEventListener('scroll', onGlobalClose, true);
}

/** @param {KeyboardEvent} e */
function handleKeyDown(e) {
  const menu = openMenus[openMenus.length - 1];
  if (!menu) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeContextMenu();
    return;
  }

  const rows = Array.from(menu.querySelectorAll(`.${BASE}__item:not([disabled])`));
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    rows[(current + 1) % rows.length].focus({ preventScroll: true });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    rows[(current - 1 + rows.length) % rows.length].focus({ preventScroll: true });
  } else if (e.key === 'Home') {
    e.preventDefault();
    rows[0].focus({ preventScroll: true });
  } else if (e.key === 'End') {
    e.preventDefault();
    rows[rows.length - 1].focus({ preventScroll: true });
  } else if (e.key === 'ArrowRight') {
    const active = document.activeElement;
    if (active?.classList.contains(`${BASE}__item--has-submenu`)) {
      e.preventDefault();
      active.click();
    }
  } else if (e.key === 'ArrowLeft') {
    if (menu._level > 0 && menu._parentRow) {
      e.preventDefault();
      closeSubmenus();
      menu._parentRow.focus({ preventScroll: true });
    }
  }
}
