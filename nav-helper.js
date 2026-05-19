(function(){
  function isModifiedClick(event){
    return Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1));
  }
  function go(url, event){
    if (!url) return;
    if (isModifiedClick(event)) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  }
  window.corralonNavigate = function(event, url){
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    go(url, event);
  };
  document.addEventListener('click', function(event){
    var trigger = event.target && event.target.closest && event.target.closest('[data-nav-url]');
    if (!trigger) return;
    event.preventDefault();
    go(trigger.getAttribute('data-nav-url'), event);
  });
})();
