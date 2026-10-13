/* ============================================================
 * iSMART notifications: shared by every page that has the bell menu.
 *
 *  Needs attention (computed live, clears itself when fixed):
 *    - overdue borrowings
 *    - low / critical / out-of-stock assets
 *    - units needing repair (only if "Maintenance Reminders" is on)
 *  Recent activity (stored in the `notifications` table):
 *    - new asset added, new staff/admin account
 *
 * The three Settings toggles (overdue_alerts, low_stock_alerts,
 * maintenance_reminders) are respected. They are saved per browser.
 * ============================================================ */
(function () {
  'use strict';

  // ---- tweak these if needed ----
  const CRITICAL_RATIO = 0.10;      // available <= 10% of usable units -> critical
  const LOW_RATIO = 0.25;           // available <= 25% of usable units -> low
  const MIN_UNITS_FOR_STOCK_ALERT = 2; // one-of-a-kind items never raise stock alerts
  const REFRESH_MS = 120000;        // re-check every 2 minutes
  const EVENT_DAYS = 30;            // how far back "recent activity" goes
  const MAX_SHOWN = 25;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let client = null, userId = null;
  let attention = [], events = [], busy = false;

  // ------------------------------------------------------------
  // Pure logic (also exposed for testing)
  // ------------------------------------------------------------
  function localDate(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function daysBetween(fromStr, toStr) {
    const [y1, m1, d1] = fromStr.split('-').map(Number);
    const [y2, m2, d2] = toStr.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }

  function overdueItems(rows, today) {
    return (rows || []).map(r => {
      const days = Math.max(1, daysBetween(String(r.expected_return_date).slice(0, 10), today));
      const who = (r.students && r.students.full_name) || r.faculty_name || 'Unknown borrower';
      const what = (r.assets && r.assets.name) || 'an asset';
      return {
        kind: 'overdue', severity: days >= 7 ? 'high' : 'medium', sort: days,
        title: who + ' · ' + days + ' day' + (days === 1 ? '' : 's') + ' overdue',
        message: what + ' ×' + (r.quantity || 1), link: 'return.html'
      };
    });
  }

  function stockItems(assets, p) {
    const out = [];
    (assets || []).forEach(a => {
      const total = a.total_quantity || 0, avail = a.available_quantity || 0;
      const dmg = a.damaged_quantity || 0, mnt = a.maintenance_quantity || 0;
      const usable = total - dmg - mnt;

      if (p.stock && usable >= MIN_UNITS_FOR_STOCK_ALERT) {
        const critical = Math.max(1, Math.floor(usable * CRITICAL_RATIO));
        const low = Math.ceil(usable * LOW_RATIO);
        let level = null;
        if (avail === 0) level = 'Out of stock';
        else if (avail <= critical) level = 'Critical stock';
        else if (avail <= low) level = 'Low stock';
        if (level) {
          out.push({
            kind: 'stock', severity: avail <= critical ? 'high' : 'medium', sort: -avail,
            title: level + ': ' + a.name,
            message: avail + ' available of ' + usable + ' usable' + (dmg ? ' (' + dmg + ' damaged)' : ''),
            link: 'assets.html'
          });
        }
      }
      if (p.maintenance && dmg + mnt > 0) {
        out.push({
          kind: 'maintenance', severity: 'low', sort: dmg + mnt,
          title: a.name + ': ' + (dmg + mnt) + ' unit' + (dmg + mnt === 1 ? '' : 's') + ' need repair',
          message: [dmg ? dmg + ' damaged' : '', mnt ? mnt + ' in maintenance' : ''].filter(Boolean).join(', '),
          link: 'assets.html'
        });
      }
    });
    return out;
  }

  function sortAttention(list) {
    const rank = { high: 0, medium: 1, low: 2 };
    return list.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.sort - a.sort));
  }

  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('ismart_notifications') || '{}'); } catch (e) {}
    return { overdue: p.overdue_alerts !== false, stock: p.low_stock_alerts !== false, maintenance: p.maintenance_reminders === true };
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  // ------------------------------------------------------------
  // Data
  // ------------------------------------------------------------
  function getClient() {
    try { if (typeof _supabase !== 'undefined') return _supabase; } catch (e) {}
    try { if (typeof _supabaseClient !== 'undefined') return _supabaseClient; } catch (e) {}
    return null;
  }

  async function fetchOverdue() {
    const { data, error } = await client.from('borrowing_transactions')
      .select('id, quantity, expected_return_date, faculty_name, students:student_id(full_name), assets:asset_id(name)')
      .neq('status', 'Returned')
      .lt('expected_return_date', localDate(new Date()))
      .order('expected_return_date', { ascending: true })
      .limit(200);
    if (error) throw error;
    return overdueItems(data, localDate(new Date()));
  }

  async function fetchStock(p) {
    const { data, error } = await client.from('assets')
      .select('id, name, total_quantity, available_quantity, damaged_quantity, maintenance_quantity');
    if (error) throw error;
    return stockItems(data, p);
  }

  async function fetchEvents() {
    const since = new Date(Date.now() - EVENT_DAYS * 86400000).toISOString();
    const { data, error } = await client.from('notifications')
      .select('id, type, title, message, link, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;

    let readAt = null;
    try {
      const { data: me } = await client.from('users').select('notifications_read_at').eq('id', userId).single();
      readAt = me && me.notifications_read_at ? new Date(me.notifications_read_at).getTime() : null;
    } catch (e) {}

    return (data || []).map(n => ({
      kind: n.type, title: n.title, message: n.message, link: n.link, time: n.created_at,
      unread: readAt === null || new Date(n.created_at).getTime() > readAt
    }));
  }

  async function refresh() {
    if (!client || !userId || busy) return;
    busy = true;
    try {
      const p = prefs();
      const jobs = [
        p.overdue ? fetchOverdue() : Promise.resolve([]),
        (p.stock || p.maintenance) ? fetchStock(p) : Promise.resolve([]),
        fetchEvents()
      ];
      const [od, st, ev] = await Promise.allSettled(jobs);
      const warn = (name, r) => { if (r.status === 'rejected') console.warn('Notifications (' + name + '):', r.reason && r.reason.message || r.reason); };
      warn('overdue', od); warn('stock', st); warn('activity', ev);

      attention = sortAttention([...(od.value || []), ...(st.value || [])]);
      events = ev.value || [];
      updateBadge();
      if (isOpen()) render();
    } finally { busy = false; }
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  const ICONS = {
    overdue: ['fa-clock', '#EF4444', '#FEF2F2'],
    stock: ['fa-box-open', '#F59E0B', '#FFFBEB'],
    maintenance: ['fa-wrench', '#6B7280', '#F3F4F6'],
    asset_added: ['fa-plus-circle', '#3B82F6', '#EFF6FF'],
    staff_added: ['fa-user-plus', '#4F46E5', '#EEF2FF']
  };

  function unreadCount() { return events.filter(e => e.unread).length; }
  function totalCount() { return attention.length + unreadCount(); }

  function injectStyles() {
    if (document.getElementById('ismartNotifStyles')) return;
    const st = document.createElement('style');
    st.id = 'ismartNotifStyles';
    st.textContent = `
      .user-avatar.has-notif::after{content:'';position:absolute;top:-1px;right:-1px;width:11px;height:11px;border-radius:50%;background:#EF4444;border:2px solid #fff}
      .ismart-notif-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);z-index:1100;display:none;align-items:flex-start;justify-content:center;padding:70px 14px 14px}
      .ismart-notif-overlay.open{display:flex}
      .ismart-notif-panel{background:#fff;border-radius:16px;width:100%;max-width:400px;max-height:calc(100vh - 90px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;font-family:'Inter',sans-serif}
      .ismart-notif-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--gray-200,#E5E7EB)}
      .ismart-notif-head h3{font-size:16px;font-weight:700;color:var(--gray-900,#111827);margin:0}
      .ismart-notif-head .acts{display:flex;align-items:center;gap:10px}
      .ismart-notif-head button{border:none;background:none;cursor:pointer;font-family:inherit}
      .ismart-notif-read{font-size:12px;font-weight:600;color:var(--primary,#4F46E5)}
      .ismart-notif-x{font-size:22px;line-height:1;color:var(--gray-500,#6B7280)}
      .ismart-notif-body{overflow-y:auto;-webkit-overflow-scrolling:touch}
      .ismart-notif-sec{display:flex;justify-content:space-between;padding:10px 16px 6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--gray-500,#6B7280);background:var(--gray-50,#F9FAFB)}
      .ismart-notif-item{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--gray-100,#F3F4F6);cursor:pointer}
      .ismart-notif-item:hover{background:var(--gray-50,#F9FAFB)}
      .ismart-notif-ico{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
      .ismart-notif-txt{min-width:0;flex:1}
      .ismart-notif-t{font-size:13px;font-weight:600;color:var(--gray-800,#1F2937);word-break:break-word}
      .ismart-notif-item.unread .ismart-notif-t::after{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#4F46E5;margin-left:6px;vertical-align:middle}
      .ismart-notif-m{font-size:12px;color:var(--gray-600,#4B5563);margin-top:2px;word-break:break-word}
      .ismart-notif-time{font-size:10px;color:var(--gray-400,#9CA3AF);margin-top:3px}
      .ismart-notif-more,.ismart-notif-empty{padding:16px;text-align:center;font-size:12px;color:var(--gray-500,#6B7280)}
      .ismart-notif-empty i{display:block;font-size:30px;color:var(--gray-300,#D1D5DB);margin-bottom:8px}`;
    document.head.appendChild(st);
  }

  function ensurePanel() {
    let ov = document.getElementById('ismartNotifOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'ismartNotifOverlay';
    ov.className = 'ismart-notif-overlay';
    ov.innerHTML = `<div class="ismart-notif-panel" role="dialog" aria-modal="true" aria-label="Notifications">
        <div class="ismart-notif-head"><h3>Notifications</h3>
          <div class="acts"><button type="button" class="ismart-notif-read" id="ismartNotifRead">Mark all read</button>
          <button type="button" class="ismart-notif-x" id="ismartNotifX" aria-label="Close notifications">&times;</button></div></div>
        <div class="ismart-notif-body" id="ismartNotifBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closePanel(); });
    document.getElementById('ismartNotifX').addEventListener('click', closePanel);
    document.getElementById('ismartNotifRead').addEventListener('click', markAllRead);
    document.getElementById('ismartNotifBody').addEventListener('click', e => {
      const el = e.target.closest('[data-link]');
      if (el && /^[a-z0-9_-]+\.html$/i.test(el.dataset.link)) window.location.href = el.dataset.link;
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
    return ov;
  }

  const isOpen = () => { const o = document.getElementById('ismartNotifOverlay'); return !!o && o.classList.contains('open'); };

  function itemHtml(n) {
    const [icon, color, bg] = ICONS[n.kind] || ICONS.asset_added;
    return `<div class="ismart-notif-item${n.unread ? ' unread' : ''}" ${n.link ? 'data-link="' + esc(n.link) + '"' : ''}>
        <div class="ismart-notif-ico" style="color:${color};background:${bg}"><i class="fas ${icon}"></i></div>
        <div class="ismart-notif-txt"><div class="ismart-notif-t">${esc(n.title)}</div>
          ${n.message ? '<div class="ismart-notif-m">' + esc(n.message) + '</div>' : ''}
          ${n.time ? '<div class="ismart-notif-time">' + esc(timeAgo(n.time)) + '</div>' : ''}</div></div>`;
  }

  function render() {
    let html = '';
    if (attention.length) {
      html += '<div class="ismart-notif-sec"><span>Needs attention</span><span>' + attention.length + '</span></div>';
      html += attention.slice(0, MAX_SHOWN).map(itemHtml).join('');
      if (attention.length > MAX_SHOWN) html += '<div class="ismart-notif-more">+ ' + (attention.length - MAX_SHOWN) + ' more</div>';
    }
    if (events.length) {
      html += '<div class="ismart-notif-sec"><span>Recent activity</span></div>' + events.map(itemHtml).join('');
    }
    if (!html) html = '<div class="ismart-notif-empty"><i class="fas fa-check-circle"></i>You\'re all caught up</div>';
    document.getElementById('ismartNotifBody').innerHTML = html;
    document.getElementById('ismartNotifRead').style.display = unreadCount() ? '' : 'none';
  }

  function updateBadge() {
    const n = totalCount();
    document.querySelectorAll('.dropdown-item[onclick*="showNotifications"]').forEach(btn => {
      let b = btn.querySelector('.notif-badge') || btn.querySelector('span');
      if (!b) { b = document.createElement('span'); btn.appendChild(b); }
      b.className = 'notif-badge';
      b.style.cssText = 'margin-left:auto;background:var(--danger,#EF4444);color:white;font-size:10px;padding:1px 8px;border-radius:10px;' + (n ? '' : 'display:none;');
      b.textContent = n > 99 ? '99+' : String(n);
    });
    document.querySelectorAll('.user-avatar').forEach(a => a.classList.toggle('has-notif', n > 0));
  }

  async function openPanel() {
    injectStyles(); ensurePanel();
    const dd = document.getElementById('userDropdown'); if (dd) dd.classList.remove('show');
    render();
    document.getElementById('ismartNotifOverlay').classList.add('open');
    await refresh();
  }

  function closePanel() {
    const o = document.getElementById('ismartNotifOverlay'); if (o) o.classList.remove('open');
  }

  async function markAllRead() {
    try {
      const { error } = await client.rpc('mark_notifications_read');
      if (error) throw error;
      events.forEach(e => { e.unread = false; });
      updateBadge(); render();
    } catch (e) { console.warn('Could not mark notifications read:', e.message || e); }
  }

  // ------------------------------------------------------------
  // Start
  // ------------------------------------------------------------
  window.showNotifications = openPanel;   // replaces the old hardcoded version on each page

  async function start() {
    injectStyles();
    client = getClient();
    if (!client) return;
    try {
      const { data } = await client.auth.getUser();
      userId = data && data.user && data.user.id;
    } catch (e) {}
    if (!userId) return;

    // Settings page: refresh when a notification toggle changes
    if (typeof window.toggleSwitch === 'function') {
      const orig = window.toggleSwitch;
      window.toggleSwitch = function () { const r = orig.apply(this, arguments); setTimeout(refresh, 0); return r; };
    }

    await refresh();
    setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.ISMARTNotifications = { refresh, open: openPanel, _test: { overdueItems, stockItems, sortAttention, daysBetween } };
})();