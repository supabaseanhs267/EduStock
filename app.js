// ============================================================
// APP.JS - EduStock Shared Functions with Supabase
// ============================================================

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
const SUPABASE_URL = 'https://zvbbnwawvbmxfygvkyaq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_LQd5C3G15qa-svzIDMadAw_ErT3Usmd';

// ============================================================
// INITIALIZE SUPABASE (Only once)
// ============================================================
// Check if already initialized to avoid duplicate declaration
if (typeof window.supabase === 'undefined') {
    window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase initialized:', SUPABASE_URL);
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function showToast(text, type = 'info') {
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.className = 'toast hidden';
        toast.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <span id="toastMessage">Toast message</span>
            <button class="close-toast">&times;</button>
        `;
        document.body.appendChild(toast);
        
        toast.querySelector('.close-toast').addEventListener('click', function() {
            toast.classList.add('hidden');
            clearTimeout(toast._timeout);
        });
    }
    
    const messageEl = document.getElementById('toastMessage');
    const icon = toast.querySelector('i');
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.className = `toast ${type}`;
    messageEl.textContent = text;
    icon.className = `fas ${icons[type] || icons.info}`;
    
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// ============================================================
// LOAD USER SESSION
// ============================================================
function loadUserSession() {
    try {
        const session = JSON.parse(localStorage.getItem('edustock_session'));
        if (session && session.profile) {
            const name = session.profile.full_name || 'User';
            const role = session.profile.role || 'Staff';
            
            const greetingEl = document.getElementById('userGreeting');
            const roleEl = document.getElementById('userRole');
            
            if (greetingEl) {
                greetingEl.textContent = `Welcome back, ${name}! 👋`;
            }
            if (roleEl) {
                let roleText = `${role.charAt(0).toUpperCase() + role.slice(1)} · Alitagtag NHS`;
                if (role === 'admin') {
                    roleText += ' (Admin)';
                }
                roleEl.textContent = roleText;
            }
            return { name, role };
        }
    } catch (e) {
        console.error('Session error:', e);
    }
    
    const greetingEl = document.getElementById('userGreeting');
    const roleEl = document.getElementById('userRole');
    if (greetingEl) greetingEl.textContent = 'Welcome! 👋';
    if (roleEl) roleEl.textContent = 'Staff · Alitagtag NHS';
    
    return null;
}

// ============================================================
// UPDATE ACTIVE NAV
// ============================================================
function updateActiveNav() {
    const currentPage = window.location.pathname.split('/').pop();
    const pageMap = {
        'dashboard.html': 'dashboard',
        'assets.html': 'assets',
        'borrow.html': 'borrow',
        'return.html': 'return',
        'students.html': 'students',
        'settings.html': 'settings',
        'activity.html': 'activity'
    };
    
    const expectedPage = pageMap[currentPage];
    if (expectedPage) {
        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.dataset.page === expectedPage) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
}

// ============================================================
// SETUP NAVIGATION
// ============================================================
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const page = this.dataset.page;
            window.location.href = `${page}.html`;
        });
    });
}

// ============================================================
// LOGOUT
// ============================================================
function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function() {
            if (confirm('Are you sure you want to logout?')) {
                await window.supabase.auth.signOut();
                localStorage.removeItem('edustock_session');
                showToast('👋 Logged out successfully!', 'success');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1000);
            }
        });
    }
}

// ============================================================
// FORMAT TIME AGO
// ============================================================
function formatTimeAgo(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const diff = Math.floor((now - then) / 1000);
    
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return then.toLocaleDateString();
}

// ============================================================
// AUTH CHECK (Redirect to login if not authenticated)
// ============================================================
async function checkAuth() {
    const session = JSON.parse(localStorage.getItem('edustock_session'));
    if (!session) {
        window.location.href = 'login.html';
        return false;
    }
    
    try {
        const { data, error } = await window.supabase.auth.getUser();
        if (error || !data.user) {
            localStorage.removeItem('edustock_session');
            window.location.href = 'login.html';
            return false;
        }
        return true;
    } catch (e) {
        console.error('Auth check error:', e);
        return false;
    }
}

// ============================================================
// INIT - Runs on every page
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    loadUserSession();
    updateActiveNav();
    setupNavigation();
    setupLogout();
    console.log('📦 EduStock App Loaded');
});

// Export functions to global scope for use in pages
window.showToast = showToast;
window.loadUserSession = loadUserSession;
window.updateActiveNav = updateActiveNav;
window.setupNavigation = setupNavigation;
window.setupLogout = setupLogout;
window.formatTimeAgo = formatTimeAgo;
window.checkAuth = checkAuth;