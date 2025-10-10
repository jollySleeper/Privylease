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

    // Setup event listeners for buttons and inputs
    setupEventListeners();
    setupActivityTracking();
});

function setupEventListeners() {
    // Password input enter key handler
    const passwordInput = document.getElementById('passwordInput');
    passwordInput.addEventListener('keypress', handleEnter);

    // Login button click handler
    const loginButton = document.getElementById('loginButton');
    loginButton.addEventListener('click', login);

    // Logout button click handler
    const logoutButton = document.getElementById('logoutButton');
    logoutButton.addEventListener('click', logout);

    // Initially hide loading spinner
    const loading = document.getElementById('loading');
    loading.style.display = 'none';
}

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
            // Handle different error types
            if (response.status === 429) {
                // Rate limiting error
                const errorData = await response.json();
                throw new Error(errorData.error + (errorData.retryAfter ? ` (try again in ${Math.ceil(errorData.retryAfter / 60)} minutes)` : ''));
            } else if (response.status === 401) {
                throw new Error('Invalid password');
            } else {
                throw new Error(`Server error: ${response.status}`);
            }
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
            // Handle different error types
            if (response.status === 429) {
                // Rate limiting error
                const errorData = await response.json();
                throw new Error(errorData.error + (errorData.retryAfter ? ` (try again in ${Math.ceil(errorData.retryAfter / 60)} minutes)` : ''));
            } else if (response.status === 401) {
                // Password expired or invalid - logout user
                logout();
                throw new Error('Session expired. Please log in again.');
            } else {
                throw new Error(`Failed to fetch releases (${response.status})`);
            }
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

            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'button-container';

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'download-btn';
            downloadBtn.textContent = '⬇️ Download';
            downloadBtn.onclick = (event) => downloadAsset(event, asset.id, asset.name);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = '📋 Copy Link';
            copyBtn.onclick = (event) => copyDownloadLink(event, asset.id, asset.name);

            buttonContainer.appendChild(downloadBtn);
            buttonContainer.appendChild(copyBtn);

            assetInfo.appendChild(assetName);
            assetInfo.appendChild(assetSize);
            assetItem.appendChild(assetInfo);
            assetItem.appendChild(buttonContainer);
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
            // Handle different error types
            if (response.status === 429) {
                // Rate limiting error
                const errorData = await response.json();
                throw new Error(errorData.error + (errorData.retryAfter ? ` (try again in ${Math.ceil(errorData.retryAfter / 60)} minutes)` : ''));
            } else if (response.status === 401) {
                // Password expired - logout user
                logout();
                throw new Error('Session expired. Please log in again.');
            } else if (response.status === 404) {
                throw new Error('Download URL not found');
            } else {
                throw new Error(`Failed to get download URL (${response.status})`);
            }
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

async function copyDownloadLink(event, assetId, fileName) {
    event.preventDefault();
    const button = event.target;
    const originalText = button.textContent;

    try {
        button.disabled = true;
        button.textContent = '🔗 Getting link...';

        // Get download URL from Cloudflare Worker (same as download)
        const response = await fetch(`${WORKER_URL}/download-url/${assetId}`, {
            headers: {
                'X-Password': password
            }
        });

        if (!response.ok) {
            // Handle different error types
            if (response.status === 429) {
                // Rate limiting error
                const errorData = await response.json();
                throw new Error(errorData.error + (errorData.retryAfter ? ` (try again in ${Math.ceil(errorData.retryAfter / 60)} minutes)` : ''));
            } else if (response.status === 401) {
                // Password expired - logout user
                logout();
                throw new Error('Session expired. Please log in again.');
            } else if (response.status === 404) {
                throw new Error('Download URL not found');
            } else {
                throw new Error(`Failed to get download URL (${response.status})`);
            }
        }

        const data = await response.json();

        // Copy URL to clipboard
        await navigator.clipboard.writeText(data.downloadUrl);

        // Success feedback
        button.textContent = '✅ Copied!';
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 2000);

    } catch (err) {
        button.textContent = originalText;
        button.disabled = false;
        if (err.name === 'NotAllowedError') {
            showError('Clipboard access denied. Please allow clipboard permissions.');
        } else {
            showError(`Failed to copy link for ${fileName}: ${err.message}`);
        }
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
