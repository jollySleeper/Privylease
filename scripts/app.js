// CHANGE THIS to your Cloudflare Worker URL
const WORKER_URL = 'https://your-worker.your-subdomain.workers.dev';

let password = sessionStorage.getItem('password');
let sessionTimeoutId = null;
let warningTimeoutId = null;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_TIME_MS = 5 * 60 * 1000; // 5 minutes before timeout

// UI Constants
const UI_CONSTANTS = {
    BUTTON_SUCCESS_TIMEOUT: 2000,     // 2 seconds for button success feedback
    ERROR_DISPLAY_TIMEOUT: 5000,      // 5 seconds for error messages
    WARNING_DISPLAY_TIMEOUT: 10000,   // 10 seconds for session warnings
    ACTIVITY_EVENTS: ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
};

// Cache for download URLs to avoid repeated API calls
const downloadUrlCache = new Map();

// DOM element references for better performance
const elements = {
    loginBox: document.getElementById('loginBox'),
    logoutSection: document.getElementById('logoutSection'),
    passwordInput: document.getElementById('passwordInput'),
    loginButton: document.getElementById('loginButton'),
    logoutButton: document.getElementById('logoutButton'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    releases: document.getElementById('releases')
};

/**
 * Utility functions for common operations
 */
const utils = {
    /**
     * Format a date for display in release headers
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted date string
     */
    formatReleaseDate: (dateString) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    /**
     * Create a safe DOM element with text content
     * @param {string} tagName - HTML tag name
     * @param {string} className - CSS class name
     * @param {string} textContent - Text content
     * @returns {HTMLElement} Created element
     */
    createElement: (tagName, className, textContent) => {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }
};

/**
 * Centralized API error handler for consistent error processing
 * @param {Response} response - The fetch response object
 * @param {string} context - Context for error message ('login', 'releases', 'download-url')
 * @returns {never} Always throws an Error
 */
async function handleApiError(response, context = 'api') {
    if (response.status === 429) {
        // Rate limiting error
        const errorData = await response.json();
        throw new Error(errorData.error + (errorData.retryAfter ? ` (try again in ${Math.ceil(errorData.retryAfter / 60)} minutes)` : ''));
    }

    if (response.status === 401) {
        // Authentication error - logout user
        logout();
        if (context === 'login') {
            throw new Error('Invalid password');
        } else {
            throw new Error('Session expired. Please log in again.');
        }
    }

    if (response.status === 404 && context === 'download-url') {
        throw new Error('Download URL not found');
    }

    // Generic server errors
    if (context === 'login') {
        throw new Error(`Server error: ${response.status}`);
    } else if (context === 'releases') {
        throw new Error(`Failed to fetch releases (${response.status})`);
    } else if (context === 'download-url') {
        throw new Error(`Failed to get download URL (${response.status})`);
    } else {
        throw new Error(`Server error (${response.status})`);
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    if (password) {
        elements.loginBox.style.display = 'none';
        elements.logoutSection.classList.add('active');
        startSessionTimeout();
        loadReleases();
    }

    // Setup event listeners for buttons and inputs
    setupEventListeners();
    setupActivityTracking();
});

function setupEventListeners() {
    // Password input enter key handler
    elements.passwordInput.addEventListener('keypress', handleEnter);

    // Login button click handler
    elements.loginButton.addEventListener('click', login);

    // Logout button click handler
    elements.logoutButton.addEventListener('click', logout);

    // Initially hide loading spinner
    elements.loading.style.display = 'none';
}

function handleEnter(event) {
    if (event.key === 'Enter') {
        login();
    }
}

async function login() {
    const inputPassword = elements.passwordInput.value;

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
            await handleApiError(response, 'login');
        }

        // Store password in session
        sessionStorage.setItem('password', inputPassword);
        password = inputPassword;

        // Update UI
        elements.loginBox.style.display = 'none';
        elements.logoutSection.classList.add('active');
        elements.passwordInput.value = '';

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

    // Clear download URL cache
    downloadUrlCache.clear();

    elements.loginBox.style.display = 'block';
    elements.logoutSection.classList.remove('active');
    elements.releases.innerHTML = '';
    elements.releases.classList.remove('active');
    elements.passwordInput.value = '';
}

async function loadReleases() {
    const loading = elements.loading;
    const releases = elements.releases;
    const error = elements.error;

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
            await handleApiError(response, 'releases');
        }

        const data = await response.json();
        loading.style.display = 'none';

        if (data.length === 0) {
            // Clear previous content
            releases.innerHTML = '';
            // Create no releases message safely
            const noReleasesDiv = utils.createElement('div', 'no-releases', 'No releases found');
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
    const container = elements.releases;

    releasesData.forEach(release => {
        const assets = release.assets;

        if (assets.length === 0) return;

        const releaseDiv = document.createElement('div');
        releaseDiv.className = 'release';

        const date = utils.formatReleaseDate(release.published_at);

        // Create release header safely
        const releaseHeader = utils.createElement('div', 'release-header');
        const releaseTitle = utils.createElement('div', 'release-title', release.name || release.tag_name);
        const releaseDate = utils.createElement('div', 'release-date', `📅 ${date}`);
        const releaseTag = utils.createElement('span', 'release-tag', release.tag_name);

        releaseHeader.appendChild(releaseTitle);
        releaseHeader.appendChild(releaseDate);
        releaseHeader.appendChild(releaseTag);

        const assetList = utils.createElement('div', 'asset-list');
        assetList.id = `release-${release.id}`;

        releaseDiv.appendChild(releaseHeader);
        releaseDiv.appendChild(assetList);
        container.appendChild(releaseDiv);

        // Create asset items safely
        assets.forEach(asset => {
            const size = formatBytes(asset.size);
            const icon = getFileIcon(asset.name);

            const assetItem = utils.createElement('div', 'asset-item');
            const assetInfo = utils.createElement('div', 'asset-info');
            const assetName = utils.createElement('div', 'asset-name', `${icon} ${asset.name}`);
            const assetSize = utils.createElement('div', 'asset-size', size);

            // Create button container
            const buttonContainer = utils.createElement('div', 'button-container');

            const downloadBtn = utils.createElement('button', 'download-btn', '⬇️ Download');
            downloadBtn.onclick = (event) => downloadAsset(event, asset.id, asset.name);

            const copyBtn = utils.createElement('button', 'copy-btn', '📋 Copy Link');
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

        // Get download URL using shared function (with caching)
        const downloadUrl = await getDownloadUrl(assetId, fileName);

        // Open download URL in new tab (direct download from GitHub CDN)
        window.open(downloadUrl, '_blank');

        // Success feedback
        button.textContent = '✅ Opening download...';
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, UI_CONSTANTS.BUTTON_SUCCESS_TIMEOUT);

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

        // Get download URL using shared function (with caching)
        const downloadUrl = await getDownloadUrl(assetId, fileName);

        // Copy URL to clipboard
        await navigator.clipboard.writeText(downloadUrl);

        // Success feedback
        button.textContent = '✅ Copied!';
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, UI_CONSTANTS.BUTTON_SUCCESS_TIMEOUT);

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

async function getDownloadUrl(assetId, fileName) {
    // Check cache first
    if (downloadUrlCache.has(assetId)) {
        return downloadUrlCache.get(assetId);
    }

    // Fetch from API
    const response = await fetch(`${WORKER_URL}/download-url/${assetId}`, {
        headers: {
            'X-Password': password
        }
    });

    if (!response.ok) {
        await handleApiError(response, 'download-url');
    }

    const data = await response.json();

    // Cache the URL for future use
    downloadUrlCache.set(assetId, data.downloadUrl);

    return data.downloadUrl;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showError(message) {
    const error = elements.error;
    // Clear previous content
    error.innerHTML = '';
    // Create error div safely
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = `❌ ${message}`;
    error.appendChild(errorDiv);
    setTimeout(() => {
        error.innerHTML = '';
    }, UI_CONSTANTS.ERROR_DISPLAY_TIMEOUT);
}

function setupActivityTracking() {
    // Reset session timeout on user activity
    UI_CONSTANTS.ACTIVITY_EVENTS.forEach(event => {
        document.addEventListener(event, resetSessionTimeout, { passive: true });
    });
}

function removeActivityTracking() {
    // Remove activity tracking event listeners
    UI_CONSTANTS.ACTIVITY_EVENTS.forEach(event => {
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
    const error = elements.error;
    // Clear previous content
    error.innerHTML = '';
    // Create warning div safely
    const warningDiv = document.createElement('div');
    warningDiv.className = 'error';
    warningDiv.style.background = '#f39c12';
    warningDiv.style.color = 'white';
    warningDiv.textContent = '⚠️ Your session will expire in 5 minutes due to inactivity. Move your mouse or press a key to extend your session.';
    error.appendChild(warningDiv);
    // Auto-hide warning after specified timeout
    setTimeout(() => {
        if (error.contains(warningDiv)) {
            error.innerHTML = '';
        }
    }, UI_CONSTANTS.WARNING_DISPLAY_TIMEOUT);
}
