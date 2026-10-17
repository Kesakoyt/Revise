/**
 * Fiches & Cloud — split-screen layout utility.
 *
 * Builds a flex row of up to 3 panels with draggable dividers between them.
 * Panels are plain elements; the workspace owns their contents.
 */

const MAX_PANELS = 3;
const MIN_PANEL_WIDTH = 220;

/**
 * Reset a container into a split layout.
 * @param {HTMLElement} container
 * @param {number} [panelCount=0]
 * @returns {HTMLElement[]}
 */
export function createLayout(container, panelCount = 0) {
  if (!container) return [];

  container.classList.add('workspace--split-layout');
  container.style.display = 'flex';
  container.style.flexDirection = 'row';
  container.innerHTML = '';

  const panels = [];
  const count = Math.min(Math.max(0, panelCount), MAX_PANELS);
  for (let i = 0; i < count; i++) {
    const panel = addPanel(container);
    if (panel) panels.push(panel);
  }
  return panels;
}

/** @returns {number} number of panels currently mounted */
export function getPanelCount(container) {
  return container ? container.querySelectorAll('.workspace__panel').length : 0;
}

/**
 * Append a new panel (no-op beyond MAX_PANELS).
 * @param {HTMLElement} container
 * @returns {HTMLElement|null}
 */
export function addPanel(container) {
  if (!container || getPanelCount(container) >= MAX_PANELS) return null;

  const panel = document.createElement('section');
  panel.className = 'workspace__panel';
  container.appendChild(panel);

  syncDividers(container);
  redistribute(container);
  return panel;
}

/**
 * Remove a panel and reflow the rest.
 * @param {HTMLElement} container
 * @param {HTMLElement} panelElement
 */
export function removePanel(container, panelElement) {
  if (!container || !panelElement) return;
  if (panelElement.parentElement === container) container.removeChild(panelElement);
  syncDividers(container);
  redistribute(container);
}

/** Rebuild dividers so panels interleave as [P0][D0][P1][D1][P2]. */
function syncDividers(container) {
  container.querySelectorAll('.workspace__divider').forEach(d => d.remove());

  const panels = [...container.querySelectorAll('.workspace__panel')];
  for (let i = 1; i < panels.length; i++) {
    const divider = document.createElement('div');
    divider.className = 'workspace__divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('tabindex', '0');
    divider.title = 'Glisser pour redimensionner';
    container.insertBefore(divider, panels[i]);
    attachDrag(divider, container);
  }
}

/** Give every panel an equal flex share. */
function redistribute(container) {
  container.querySelectorAll('.workspace__panel').forEach(panel => {
    panel.style.flex = '1 1 0%';
    panel.style.width = '';
  });
}

/** Wire pointer-drag resizing onto a divider. */
function attachDrag(divider, container) {
  let dragging = false;
  let startX = 0;
  let prev = null;
  let next = null;
  let prevStart = 0;
  let nextStart = 0;
  let total = 0;

  const onMove = e => {
    if (!dragging || !prev || !next) return;
    const delta = e.clientX - startX;
    let prevW = prevStart + delta;
    let nextW = nextStart - delta;

    if (prevW < MIN_PANEL_WIDTH) { prevW = MIN_PANEL_WIDTH; nextW = total - MIN_PANEL_WIDTH; }
    else if (nextW < MIN_PANEL_WIDTH) { nextW = MIN_PANEL_WIDTH; prevW = total - MIN_PANEL_WIDTH; }

    prev.style.flex = `${prevW} ${prevW} 0px`;
    next.style.flex = `${nextW} ${nextW} 0px`;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('workspace__divider--active');
    document.body.classList.remove('is-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  divider.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    prev = divider.previousElementSibling;
    next = divider.nextElementSibling;
    if (!prev || !next) return;

    dragging = true;
    startX = e.clientX;
    prevStart = prev.getBoundingClientRect().width;
    nextStart = next.getBoundingClientRect().width;
    total = prevStart + nextStart;

    divider.classList.add('workspace__divider--active');
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
