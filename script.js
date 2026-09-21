// Dark mode toggle functionality
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Check for saved theme preference or default to light mode
const currentTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', currentTheme);
if (themeToggle) updateThemeIcon(currentTheme);

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

// Easter egg: Ctrl+Shift+Y opens the blog/content admin
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'Y') {
        e.preventDefault();
        window.location.href = 'admin.html';
    }
});

// Hidden shortcut: Cmd+Y opens the password-protected admin portal, and
// only that; nothing else runs on this combo.
document.addEventListener('keydown', (e) => {
    if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        window.location.href = 'admin-portal.html';
    }
});

function updateThemeIcon(theme) {
    const icon = themeToggle.querySelector('svg');
    if (theme === 'dark') {
        // Sun icon for dark mode
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    } else {
        // Moon icon for light mode
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
}


// GitHub star count for youdaheDB. The Worker proxies and caches the GitHub
// API, so this is one cheap call; if it fails the badge simply stays hidden.
(function loadStars() {
    const badge = document.getElementById('youdahedbStars');
    if (!badge) return;

    fetch('/api/stars')
        .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
        .then(({ stars }) => {
            if (typeof stars !== 'number') return;
            badge.querySelector('.gh-stars-count').textContent = stars.toLocaleString();
            badge.setAttribute('aria-label', `${stars} stars on GitHub`);
            badge.hidden = false;
        })
        .catch(() => {});
})();
