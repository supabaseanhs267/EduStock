// ============================================================
// NAV.JS - Global Navigation Functions
// ============================================================

// ============================================================
// UPDATE ACTIVE NAV (Based on current page)
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
// SETUP NAVIGATION (Click handlers for all nav items)
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
// TOAST NOTIFICATION (Shared across all pages)
// ============================================================
function showToast(text, type = 'info') {
    // Check if toast element exists, create if not
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
// LOAD USER SESSION (Shared across all pages)
// ============================================================
function loadUserSession() {
    try {
        const session = JSON.parse(localStorage.getItem('edustock_session'));
        if (session && session.profile) {
            const name = session.profile.name || 'User';
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
    
    // Fallback if no session
    const greetingEl = document.getElementById('userGreeting');
    const roleEl = document.getElementById('userRole');
    if (greetingEl) greetingEl.textContent = 'Welcome! 👋';
    if (roleEl) roleEl.textContent = 'Staff · Alitagtag NHS';
    
    return null;
}

// ============================================================
// LOGOUT (Shared across all pages)
// ============================================================
function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to logout?')) {
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
// INIT (Run on every page)
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    loadUserSession();
    updateActiveNav();
    setupNavigation();
    setupLogout();
});