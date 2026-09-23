(() => {
  'use strict';

  const selector = '.modal.visible, .ranking-overlay.visible';
  const focusSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
  const app = document.querySelector('.app');
  const origins = new WeakMap();
  const lastFocusedByModal = new WeakMap();
  let active = null;
  let lastOutsideFocus = document.activeElement;

  function top() {
    return [...document.querySelectorAll(selector)]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .sort((left, right) => {
        if (left === right) return 0;
        const z = (Number.parseInt(getComputedStyle(left).zIndex, 10) || 0) -
          (Number.parseInt(getComputedStyle(right).zIndex, 10) || 0);
        return z || (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      }).at(-1) || null;
  }

  function focusable(modal) {
    return [...modal.querySelectorAll(focusSelector)].filter((element) =>
      element.tabIndex >= 0 && element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]'));
  }

  function focusFirst(modal) {
    const first = focusable(modal)[0] || modal.querySelector('.modal-card, .ranking-dialog');
    if (!first) return;
    if (first.tabIndex < 0 && !first.matches(focusSelector)) first.tabIndex = -1;
    first.focus({ preventScroll: true });
  }

  function sync() {
    const current = top();
    if (current !== active && current && !origins.has(current)) {
      const origin = active
        ? (lastFocusedByModal.get(active) || (active.contains(document.activeElement) ? document.activeElement : null))
        : lastOutsideFocus;
      origins.set(current, origin instanceof HTMLElement ? origin : null);
    }
    if (app) app.inert = !!current;
    document.querySelectorAll('.modal, .ranking-overlay').forEach((modal) => {
      modal.inert = modal.classList.contains('visible') && modal !== current;
      const dialog = modal.querySelector('.modal-card, .ranking-dialog');
      if (dialog) {
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', modal === current ? 'true' : 'false');
      }
    });
    const previous = active;
    active = current;
    if (current) {
      const origin = previous && previous !== current ? origins.get(previous) : null;
      if (origin?.isConnected && current.contains(origin)) origin.focus({ preventScroll: true });
      else if (!current.contains(document.activeElement)) requestAnimationFrame(() => {
        if (top() === current && !current.contains(document.activeElement)) focusFirst(current);
      });
    } else if (previous) {
      const origin = origins.get(previous);
      if (origin?.isConnected && !origin.closest('[inert]')) origin.focus({ preventScroll: true });
    }
    if (previous && previous !== current) origins.delete(previous);
  }

  document.addEventListener('focusin', (event) => {
    const current = top();
    if (!current) { lastOutsideFocus = event.target; return; }
    if (active?.contains(event.target)) lastFocusedByModal.set(active, event.target);
    if (!current.contains(event.target)) {
      event.stopImmediatePropagation();
      focusFirst(current);
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    const current = top();
    if (!current) return;
    if (!current.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      focusFirst(current);
      return;
    }
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const controls = focusable(current);
    if (!controls.length) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      controls[0].focus();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    const current = top();
    if (!current || event.key !== 'Escape' || event.defaultPrevented || !current.classList.contains('modal')) return;
    const close = current.querySelector('[id^="close"], [id^="cancel"]');
    if (!close) return;
    event.preventDefault();
    close.click();
  });

  new MutationObserver(sync).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
  window.PedidosModalFocus = { top, sync };
  sync();
})();
