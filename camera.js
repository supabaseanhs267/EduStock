/* ============================================================
 * iSMART camera access
 * Every camera use (QR scanners and ID photo capture) goes through
 * navigator.mediaDevices.getUserMedia. This file sits in front of it:
 *   - first time: shows an iSMART message explaining why the camera is needed
 *   - if the camera is blocked: shows how to turn it back on
 * The browser's own permission prompt cannot be hidden by a web page; it
 * appears once, right after "Allow camera". In an Android app built with
 * Capacitor, the system shows "Allow iSMART to take pictures?" instead.
 * ============================================================ */
(function () {
  'use strict';

  const SEEN_KEY = 'ismart_camera_intro_seen';

  // ---------- core logic (kept separate so it can be tested) ----------
  function notAllowed(message) {
    try { return new DOMException(message, 'NotAllowedError'); }
    catch (e) { const err = new Error(message); err.name = 'NotAllowedError'; return err; }
  }

  function makeGate(d) {
    return async function (constraints) {
      if (!constraints || !constraints.video) return d.original(constraints);   // microphone etc.: leave alone

      for (let attempt = 0; ; attempt++) {
        const state = await d.queryState();

        if (state === 'denied') {
          // Blocked in Chrome. They can fix it in settings and tap "Try again": we re-check and carry on.
          const retry = await d.showBlocked(attempt > 0);
          if (!retry) throw notAllowed('Camera permission is blocked');
          continue;
        }

        // Explain once, then let the browser's own prompt take over
        if (state !== 'granted' && !d.storage.get(SEEN_KEY)) {
          const ok = await d.askFirst();
          if (!ok) throw notAllowed('Camera access was not allowed');
          d.storage.set(SEEN_KEY, '1');
        }

        try {
          return await d.original(constraints);
        } catch (err) {
          // Only explain "blocked" when the browser really remembers a block (not a dismissed prompt)
          if (err && err.name === 'NotAllowedError' && (await d.queryState()) === 'denied') {
            const retry = await d.showBlocked(false);
            if (retry) continue;
          }
          throw err;
        }
      }
    };
  }

  // ---------- browser pieces ----------
  async function queryState() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const result = await navigator.permissions.query({ name: 'camera' });
      return result.state;                       // 'granted' | 'prompt' | 'denied'
    } catch (e) {
      return 'unknown';
    }
  }

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  let overlay = null;

  function injectStyles() {
    if (document.getElementById('ismartCamStyles')) return;
    const st = document.createElement('style');
    st.id = 'ismartCamStyles';
    st.textContent =
      '.ismart-cam-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);z-index:1300;display:none;align-items:center;justify-content:center;padding:20px}' +
      '.ismart-cam-overlay.open{display:flex}' +
      ".ismart-cam-modal{background:#fff;border-radius:16px;width:100%;max-width:320px;padding:24px 22px 18px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2);font-family:'Inter',sans-serif}" +
      '.ismart-cam-icon{width:52px;height:52px;border-radius:50%;background:#EEF2FF;color:#4F46E5;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 10px}' +
      '.ismart-cam-icon.warn{background:#FFFBEB;color:#F59E0B}' +
      '.ismart-cam-title{font-size:17px;font-weight:700;color:#111827;margin-bottom:6px}' +
      '.ismart-cam-text{font-size:13px;color:#4B5563;line-height:1.5}' +
      '.ismart-cam-note{font-size:12px;color:#6B7280;line-height:1.6;margin-top:10px;white-space:pre-line}' +
      '.ismart-cam-note.steps{text-align:left;background:#F9FAFB;border-radius:10px;padding:10px 12px}' +
      '.ismart-cam-actions{display:flex;gap:8px;margin-top:18px}' +
      ".ismart-cam-actions button{flex:1;padding:10px;border:none;border-radius:10px;background:#F3F4F6;color:#374151;font-family:'Inter',sans-serif;font-size:14px;font-weight:600;cursor:pointer}" +
      '.ismart-cam-actions button.primary{background:#4F46E5;color:#fff}';
    document.head.appendChild(st);
  }

  function show(opts) {
    injectStyles();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ismart-cam-overlay';
      overlay.innerHTML =
        '<div class="ismart-cam-modal" role="dialog" aria-modal="true">' +
          '<div class="ismart-cam-icon"><i class="fas fa-camera"></i></div>' +
          '<div class="ismart-cam-title"></div><div class="ismart-cam-text"></div>' +
          '<div class="ismart-cam-note"></div><div class="ismart-cam-actions"></div></div>';
      document.body.appendChild(overlay);
    }
    const q = sel => overlay.querySelector(sel);
    q('.ismart-cam-icon').className = 'ismart-cam-icon' + (opts.warn ? ' warn' : '');
    q('.ismart-cam-title').textContent = opts.title;
    q('.ismart-cam-text').textContent = opts.text;
    q('.ismart-cam-note').textContent = opts.note || '';
    q('.ismart-cam-note').className = 'ismart-cam-note' + (opts.steps ? ' steps' : '');
    const actions = q('.ismart-cam-actions');
    actions.innerHTML = '';

    return new Promise(resolve => {
      const done = value => { overlay.classList.remove('open'); document.removeEventListener('keydown', onKey); resolve(value); };
      const onKey = e => { if (e.key === 'Escape') done(opts.dismissValue); };
      opts.buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        if (b.primary) btn.className = 'primary';
        btn.addEventListener('click', () => done(b.value));
        actions.appendChild(btn);
      });
      document.addEventListener('keydown', onKey);
      overlay.classList.add('open');
    });
  }

  function askFirst() {
    return show({
      title: 'Allow camera access',
      text: 'iSMART uses your camera only to scan QR labels and student ID cards. Nothing is recorded or saved.',
      note: 'Your browser or phone will ask you once. Choose Allow.',
      buttons: [{ label: 'Not now', value: false }, { label: 'Allow camera', value: true, primary: true }],
      dismissValue: false
    });
  }

  function showBlocked(stillBlocked) {
    const site = (window.location && window.location.hostname) || 'this site';
    return show({
      title: 'Camera is blocked',
      text: stillBlocked
        ? 'It is still blocked. Check the steps below, then tap Try again.'
        : 'Chrome is blocking the camera for this app, so scanning cannot start.',
      note: 'To fix it:\n' +
            '1. Open Chrome, then \u22EE > Settings > Site settings > Camera\n' +
            '2. Find ' + site + ' and choose Allow\n' +
            '3. Come back here and tap Try again\n\n' +
            'Still blocked? Phone Settings > Apps > Chrome > Permissions > Camera > Allow.',
      warn: true,
      steps: true,
      buttons: [{ label: 'Close', value: false }, { label: 'Try again', value: true, primary: true }],
      dismissValue: false
    });
  }

  // ---------- install ----------
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = makeGate({ original, queryState, askFirst, showBlocked, storage });
  }

  window.ISMARTCamera = { _makeGate: makeGate };
})();
