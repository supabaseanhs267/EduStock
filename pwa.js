/* Registers the service worker (makes the app installable and gives an offline message). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('Service worker not registered:', err && err.message || err);
    });
  });
}
