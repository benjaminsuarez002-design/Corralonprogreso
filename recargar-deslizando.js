(() => {
  'use strict';
  if (window.__corralonPullRefresh) return;
  window.__corralonPullRefresh = true;
  const style = document.createElement('style');
  style.textContent = '@media(max-width:760px) and (pointer:coarse){html,body{overscroll-behavior-y:contain}}#corralon-pull-refresh{position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:50%;transform:translate(-50%,-90px);z-index:2147483647;padding:11px 18px;border-radius:24px;background:#fff;color:#171717;box-shadow:0 3px 16px #0003;font:700 14px system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .12s,transform .12s;white-space:nowrap}#corralon-pull-refresh.visible{opacity:1;transform:translate(-50%,0)}';
  document.head.appendChild(style);
  const indicator = document.createElement('div');
  indicator.id = 'corralon-pull-refresh';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  document.body.appendChild(indicator);
  let gesture = null, refreshing = false;
  const threshold = 95;
  function atTop(target) {
    for (let node = target; node instanceof Element; node = node.parentElement) {
      if (node.scrollTop > 1) return false;
    }
    return (document.scrollingElement?.scrollTop || 0) <= 1;
  }
  function cancel() { gesture = null; if (!refreshing) indicator.classList.remove('visible'); }
  document.addEventListener('touchstart', event => {
    cancel();
    if (refreshing || event.touches.length !== 1 || !matchMedia('(max-width:760px) and (pointer:coarse)').matches) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input,textarea,select,[contenteditable="true"],canvas') || !atTop(target)) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, target, distance: 0, pulling: false };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !atTop(gesture.target)) { cancel(); return; }
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - gesture.x), dy = touch.clientY - gesture.y;
    if (!gesture.pulling && (dx > 12 && dx > Math.abs(dy) || dy < -8)) { cancel(); return; }
    if (dy < 12 && !gesture.pulling) return;
    if (!event.cancelable) { cancel(); return; }
    event.preventDefault();
    gesture.pulling = true;
    gesture.distance = Math.max(0, dy);
    const message = dy >= threshold ? 'Soltá para recargar' : 'Deslizá para recargar';
    if (indicator.textContent !== message) indicator.textContent = message;
    indicator.classList.toggle('visible', dy > 15);
  }, { passive: false });
  document.addEventListener('touchend', () => {
    if (!gesture) return;
    const ready = gesture.pulling && gesture.distance >= threshold && atTop(gesture.target);
    if (!ready) { cancel(); return; }
    refreshing = true;
    gesture = null;
    indicator.textContent = 'Recargando…';
    indicator.classList.add('visible');
    setTimeout(() => {
      location.reload();
      // Restore the gesture if an existing unsaved-changes prompt cancels navigation.
      setTimeout(() => { refreshing = false; cancel(); }, 1500);
    }, 120);
  }, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
})();
