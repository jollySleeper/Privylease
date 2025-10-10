// CHANGE THIS to your Cloudflare Worker URL
const WORKER_URL = 'https://your-worker.your-subdomain.workers.dev';

let password = sessionStorage.getItem('password');
let sessionTimeoutId = null;
let warningTimeoutId = null;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_TIME_MS = 5 * 60 * 1000; // 5 minutes before timeout

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    if (password) {
        document.getElementById('loginBox').style.display = 'none';
        document.getElementById('logoutSection').classList.add('active');
        startSessionTimeout();
        loadReleases();
    }
    setupActivityTracking();
    registerServiceWorker();
});

function handleEnter(event) {
    if (event.key === 'Enter') {
        login();
    }
}

async function login() {
    const inputPassword = document.getElementById('passwordInput').value;

    if (!inputPassword) {
        showError('Please enter a password');
        return;
    }

    try {
        // Test password by fetching releases
        const response = await fetch(`${WORKER_URL}/releases`, {
            headers: {
                'X-Password': inputPassword
            }
        });

        if (!response.ok) {
            throw new Error('Invalid password');
        }

        // Store password in session
        sessionStorage.setItem('password', inputPassword);
        password = inputPassword;

        // Update UI
        document.getElementById('loginBox').style.display = 'none';
        document.getElementById('logoutSection').classList.add('active');
        document.getElementById('passwordInput').value = '';

        // Start session timeout and setup activity tracking
        startSessionTimeout();
        setupActivityTracking();

        loadReleases();
    } catch (err) {
        showError('Invalid password. Please try again.');
    }
}

function logout() {
    sessionStorage.removeItem('password');
    sessionStorage.removeItem('lastActivity');
    password = null;

    // Clear session timeouts and remove activity tracking
    clearTimeout(sessionTimeoutId);
    clearTimeout(warningTimeoutId);
    sessionTimeoutId = null;
    warningTimeoutId = null;
    removeActivityTracking();

    document.getElementById('loginBox').style.display = 'block';
    document.getElementById('logoutSection').classList.remove('active');
    document.getElementById('releases').innerHTML = '';
    document.getElementById('releases').classList.remove('active');
    document.getElementById('passwordInput').value = '';
}

async function loadReleases() {
    const loading = document.getElementById('loading');
    const releases = document.getElementById('releases');
    const error = document.getElementById('error');

    loading.style.display = 'block';
    releases.innerHTML = '';
    error.innerHTML = '';
    releases.classList.remove('active');

    try {
        const response = await fetch(`${WORKER_URL}/releases`, {
            headers: {
                'X-Password': password
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch releases');
        }

        const data = await response.json();
        loading.style.display = 'none';

        if (data.length === 0) {
            // Clear previous content
            releases.innerHTML = '';
            // Create no releases message safely
            const noReleasesDiv = document.createElement('div');
            noReleasesDiv.className = 'no-releases';
            noReleasesDiv.textContent = 'No releases found';
            releases.appendChild(noReleasesDiv);
            releases.classList.add('active');
            return;
        }

        renderReleases(data);
        releases.classList.add('active');
    } catch (err) {
        loading.style.display = 'none';
        showError(err.message);
    }
}

function renderReleases(releasesData) {
    const container = document.getElementById('releases');

    releasesData.forEach(release => {
        const assets = release.assets;

        if (assets.length === 0) return;

        const releaseDiv = document.createElement('div');
        releaseDiv.className = 'release';

        const date = new Date(release.published_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Create release header safely
        const releaseHeader = document.createElement('div');
        releaseHeader.className = 'release-header';

        const releaseTitle = document.createElement('div');
        releaseTitle.className = 'release-title';
        releaseTitle.textContent = release.name || release.tag_name;

        const releaseDate = document.createElement('div');
        releaseDate.className = 'release-date';
        releaseDate.textContent = `📅 ${date}`;

        const releaseTag = document.createElement('span');
        releaseTag.className = 'release-tag';
        releaseTag.textContent = release.tag_name;

        releaseHeader.appendChild(releaseTitle);
        releaseHeader.appendChild(releaseDate);
        releaseHeader.appendChild(releaseTag);

        const assetList = document.createElement('div');
        assetList.className = 'asset-list';
        assetList.id = `release-${release.id}`;

        releaseDiv.appendChild(releaseHeader);
        releaseDiv.appendChild(assetList);
        container.appendChild(releaseDiv);

        // Create asset items safely
        assets.forEach(asset => {
            const size = formatBytes(asset.size);
            const icon = getFileIcon(asset.name);

            const assetItem = document.createElement('div');
            assetItem.className = 'asset-item';

            const assetInfo = document.createElement('div');
            assetInfo.className = 'asset-info';

            const assetName = document.createElement('div');
            assetName.className = 'asset-name';
            assetName.textContent = `${icon} ${asset.name}`;

            const assetSize = document.createElement('div');
            assetSize.className = 'asset-size';
            assetSize.textContent = size;

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = '⬇️ Download';
            downloadBtn.onclick = (event) => downloadAsset(event, asset.id, asset.name);

            assetInfo.appendChild(assetName);
            assetInfo.appendChild(assetSize);
            assetItem.appendChild(assetInfo);
            assetItem.appendChild(downloadBtn);
            assetList.appendChild(assetItem);
        });
    });
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'apk': '📦',
        'ipa': '📱',
        'exe': '💻',
        'dmg': '🍎',
        'deb': '🐧',
        'rpm': '🎩',
        'zip': '🗜️',
        'tar': '📦',
        'gz': '🗜️',
        'pdf': '📄',
        'txt': '📄',
        'md': '📝',
        'json': '📋',
        'xml': '📋'
    };
    return iconMap[ext] || '📎';
}

async function downloadAsset(event, assetId, fileName) {
    event.preventDefault();
    const button = event.target;
    const originalText = button.textContent;

    try {
        button.disabled = true;
        button.textContent = '📥 Getting download link...';

        // Get download URL from Cloudflare Worker
        const response = await fetch(`${WORKER_URL}/download-url/${assetId}`, {
            headers: {
                'X-Password': password
            }
        });

        if (!response.ok) {
            throw new Error('Failed to get download URL');
        }

        const data = await response.json();

        // Open download URL in new tab (direct download from GitHub CDN)
        window.open(data.downloadUrl, '_blank');

        // Success feedback
        button.textContent = '✅ Opening download...';
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 2000);

    } catch (err) {
        button.textContent = originalText;
        button.disabled = false;
        showError(`Failed to download ${fileName}: ${err.message}`);
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showError(message) {
    const error = document.getElementById('error');
    // Clear previous content
    error.innerHTML = '';
    // Create error div safely
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `❌ ${message}`;
    error.appendChild(errorDiv);
    setTimeout(() => {
        error.innerHTML = '';
    }, 5000);
}

function setupActivityTracking() {
    // Reset session timeout on user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
        document.addEventListener(event, resetSessionTimeout, { passive: true });
    });
}

function removeActivityTracking() {
    // Remove activity tracking event listeners
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
        document.removeEventListener(event, resetSessionTimeout);
    });
}

function startSessionTimeout() {
    // Clear any existing timeouts
    clearTimeout(sessionTimeoutId);
    clearTimeout(warningTimeoutId);

    // Set warning timeout (5 minutes before actual timeout)
    warningTimeoutId = setTimeout(() => {
        showSessionWarning();
    }, SESSION_TIMEOUT_MS - WARNING_TIME_MS);

    // Set actual timeout
    sessionTimeoutId = setTimeout(() => {
        logout();
        showError('Session expired due to inactivity. Please log in again.');
    }, SESSION_TIMEOUT_MS);

    // Store last activity time
    sessionStorage.setItem('lastActivity', Date.now().toString());
}

function resetSessionTimeout() {
    if (password) { // Only reset if logged in
        startSessionTimeout();
    }
}

function showSessionWarning() {
    const error = document.getElementById('error');
    // Clear previous content
    error.innerHTML = '';
    // Create warning div safely
    const warningDiv = document.createElement('div');
    warningDiv.className = 'error';
    warningDiv.style.background = '#f39c12';
    warningDiv.style.color = 'white';
    warningDiv.textContent = '⚠️ Your session will expire in 5 minutes due to inactivity. Move your mouse or press a key to extend your session.';
    error.appendChild(warningDiv);
    // Auto-hide warning after 10 seconds
    setTimeout(() => {
        if (error.contains(warningDiv)) {
            error.innerHTML = '';
        }
    }, 10000);
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/scripts/sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration.scope);

                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New version available
                            showCacheUpdateNotification();
                        }
                    });
                });
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }
}

function showCacheUpdateNotification() {
    // Show notification about new version
    const notification = document.createElement('div');
    notification.className = 'error';
    notification.style.background = '#28a745';
    notification.style.color = 'white';

    // Create text node
    const textNode = document.createTextNode('🎉 App updated! ');
    notification.appendChild(textNode);

    // Create refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh to get latest version';
    refreshBtn.style.background = 'none';
    refreshBtn.style.border = 'none';
    refreshBtn.style.color = 'white';
    refreshBtn.style.textDecoration = 'underline';
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.onclick = () => location.reload();

    notification.appendChild(refreshBtn);

    const errorDiv = document.getElementById('error');
    errorDiv.appendChild(notification);

    // Auto-remove after 30 seconds
    setTimeout(() => {
        if (errorDiv.contains(notification)) {
            errorDiv.removeChild(notification);
        }
    }, 30000);
}

function forceCacheRefresh() {
    // Force clear API cache and reload data
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            action: 'clear-cache'
        });
    }

    // Clear local caches and reload
    if ('caches' in window) {
        caches.keys().then(names => {
            names.forEach(name => {
                if (name.includes('api-')) {
                    caches.delete(name);
                }
            });
        });
    }

    // Reload releases data
    loadReleases();
}
