/**
 * Fiches & Cloud — Split-Screen Workspace Layout Utility
 * Manages responsive multi-panel flex layouts (up to 3 panels) with interactive resizable dividers.
 */

const MAX_PANELS = 3;
const MIN_PANEL_WIDTH_PX = 200;

/**
 * Initialize or reset container for split-screen layout
 * @param {HTMLElement} container 
 * @param {number} [panelCount=0] - Initial number of panels to spawn (0 to 3)
 * @returns {HTMLElement[]} Array of created panel elements
 */
export function createLayout(container, panelCount = 0) {
  if (!container) return [];

  // Reset container attributes
  container.classList.add('workspace--split-layout');
  container.style.display = 'flex';
  container.style.flexDirection = 'row';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.position = 'relative';

  // Clear existing layout
  container.innerHTML = '';

  const count = Math.min(Math.max(0, panelCount), MAX_PANELS);
  const createdPanels = [];

  for (let i = 0; i < count; i++) {
    const panel = addPanel(container);
    if (panel) createdPanels.push(panel);
  }

  return createdPanels;
}

/**
 * Retrieve total number of active panels in container
 * @param {HTMLElement} container 
 * @returns {number}
 */
export function getPanelCount(container) {
  if (!container) return 0;
  return container.querySelectorAll('.workspace__panel').length;
}

/**
 * Add a new panel to the split-screen container (up to MAX_PANELS)
 * @param {HTMLElement} container 
 * @returns {HTMLElement | null} The created panel element, or null if maximum reached
 */
export function addPanel(container) {
  if (!container) return null;

  const currentCount = getPanelCount(container);
  if (currentCount >= MAX_PANELS) {
    return null;
  }

  // Create new panel element
  const panel = document.createElement('section');
  panel.className = 'workspace__panel';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.height = '100%';
  panel.style.minWidth = `${MIN_PANEL_WIDTH_PX}px`;
  panel.style.boxSizing = 'border-box';
  panel.style.position = 'relative';
  panel.style.overflow = 'hidden';

  container.appendChild(panel);

  // Re-interleave dividers and normalize flex proportions
  syncDividers(container);
  redistributeFlex(container);

  return panel;
}

/**
 * Remove an existing panel and its corresponding divider, reflowing remaining panels
 * @param {HTMLElement} container 
 * @param {HTMLElement} panelElement 
 */
export function removePanel(container, panelElement) {
  if (!container || !panelElement) return;

  if (panelElement.parentElement === container) {
    container.removeChild(panelElement);
  }

  // Re-sync dividers and equalize remaining panels
  syncDividers(container);
  redistributeFlex(container);
}

/**
 * Reconstruct dividers between all active panels to maintain proper interleaving:
 * [Panel 0] <Divider 0> [Panel 1] <Divider 1> [Panel 2]
 * @param {HTMLElement} container 
 */
function syncDividers(container) {
  // Remove all existing dividers first
  const existingDividers = container.querySelectorAll('.workspace__divider');
  existingDividers.forEach(d => d.remove());

  const panels = Array.from(container.querySelectorAll('.workspace__panel'));
  if (panels.length <= 1) {
    return;
  }

  // Insert a divider before each panel starting from index 1
  for (let i = 1; i < panels.length; i++) {
    const divider = document.createElement('div');
    divider.className = 'workspace__divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('tabindex', '0');
    divider.title = 'Glisser pour redimensionner';

    container.insertBefore(divider, panels[i]);
    attachDividerDrag(divider, container);
  }
}

/**
 * Equalize the flex basis across all active panels
 * @param {HTMLElement} container 
 */
function redistributeFlex(container) {
  const panels = container.querySelectorAll('.workspace__panel');
  panels.forEach(panel => {
    panel.style.flex = '1 1 0%';
    panel.style.width = '';
  });
}

/**
 * Attach mouse drag handler to a divider element for interactive resizing
 * @param {HTMLElement} divider 
 * @param {HTMLElement} container 
 */
function attachDividerDrag(divider, container) {
  let isDragging = false;
  let startX = 0;
  let prevPanel = null;
  let nextPanel = null;
  let startPrevWidth = 0;
  let startNextWidth = 0;
  let totalWidth = 0;

  const onMouseDown = (e) => {
    // Left click only
    if (e.button !== 0) return;

    prevPanel = divider.previousElementSibling;
    nextPanel = divider.nextElementSibling;

    if (!prevPanel || !nextPanel) return;

    isDragging = true;
    startX = e.clientX;

    const prevRect = prevPanel.getBoundingClientRect();
    const nextRect = nextPanel.getBoundingClientRect();

    startPrevWidth = prevRect.width;
    startNextWidth = nextRect.width;
    totalWidth = startPrevWidth + startNextWidth;

    divider.classList.add('workspace__divider--active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging || !prevPanel || !nextPanel) return;

    const deltaX = e.clientX - startX;
    let newPrevWidth = startPrevWidth + deltaX;
    let newNextWidth = startNextWidth - deltaX;

    // Enforce minimum width boundaries
    if (newPrevWidth < MIN_PANEL_WIDTH_PX) {
      newPrevWidth = MIN_PANEL_WIDTH_PX;
      newNextWidth = totalWidth - MIN_PANEL_WIDTH_PX;
    } else if (newNextWidth < MIN_PANEL_WIDTH_PX) {
      newNextWidth = MIN_PANEL_WIDTH_PX;
      newPrevWidth = totalWidth - MIN_PANEL_WIDTH_PX;
    }

    // Apply calculated flex proportions
    prevPanel.style.flex = `${newPrevWidth} ${newPrevWidth} 0px`;
    nextPanel.style.flex = `${newNextWidth} ${newNextWidth} 0px`;
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;

    divider.classList.remove('workspace__divider--active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  divider.addEventListener('mousedown', onMouseDown);
}
