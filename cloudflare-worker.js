/**
 * Cloudflare Worker - GitHub Release Proxy
 *
 * This worker authenticates with GitHub and provides download URLs
 * for private release assets. Token stays server-side, never exposed.
 *
 * The client downloads directly from GitHub's CDN using the provided URL,
 * saving bandwidth on the worker and providing faster downloads.
 *
 * Setup:
 * 1. Go to workers.cloudflare.com
 * 2. Create new worker
 * 3. Paste this code
 * 4. Add environment variables:
 *    - GITHUB_TOKEN: Your GitHub token
 *    - VIEWER_PASSWORD: Your password
 *    - REPO_NAME: username/repo
 * 5. Deploy!
 */

// Constants
const CONSTANTS = {
  // Rate limiting
  MAX_FAILED_ATTEMPTS: 5,
  BLOCK_DURATION_MINUTES: 15,
  RATE_LIMIT_TTL_SECONDS: 900, // 15 minutes

  // Headers
  GITHUB_API_BASE: 'https://api.github.com',
  GITHUB_API_VERSION: 'application/vnd.github.v3+json',
  USER_AGENT: 'Cloudflare-Worker',

  // CORS
  CORS_HEADERS: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Password',
    'Access-Control-Max-Age': '86400'
  },

  // Cache control
  RELEASES_CACHE_CONTROL: 'public, max-age=60',
  DOWNLOAD_URL_CACHE_CONTROL: 'no-cache'
};

/**
 * Extract client IP address from request headers
 * @param {Request} request - The incoming request
 * @returns {string} Client IP address or 'unknown'
 */
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         request.headers.get('X-Real-IP') ||
         'unknown';
}

/**
 * Create standardized JSON response
 * @param {any} data - Response data
 * @param {Object} options - Response options
 * @returns {Response}
 */
function createJSONResponse(data, options = {}) {
  const { status = 200, headers = {} } = options;

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers
    }
  });
}

/**
 * Handle rate limiting for failed authentication attempts
 * @param {Object} env - Environment variables
 * @param {string} clientIP - Client IP address
 * @returns {Promise<{isBlocked: boolean, retryAfter?: number}>}
 */
async function checkRateLimit(env, clientIP) {
  if (!env.KV) {
    console.warn('Rate limiting disabled: KV namespace not configured');
    return { isBlocked: false };
  }

  const rateLimitKey = `ratelimit:${clientIP}`;

  try {
    const rateLimitData = await env.KV.get(rateLimitKey);

    if (!rateLimitData) {
      return { isBlocked: false };
    }

    const { attempts, resetAt } = JSON.parse(rateLimitData);
    const now = Date.now();

    if (now < resetAt) {
      return {
        isBlocked: true,
        retryAfter: Math.ceil((resetAt - now) / 1000)
      };
    }

    return { isBlocked: false };
  } catch (error) {
    console.warn('Rate limiting unavailable due to KV error:', error.message);
    return { isBlocked: false };
  }
}

/**
 * Update rate limit counter after failed authentication
 * @param {Object} env - Environment variables
 * @param {string} clientIP - Client IP address
 * @param {number} currentAttempts - Current failed attempts count
 */
async function updateRateLimit(env, clientIP, currentAttempts = 0) {
  if (!env.KV) return;

  const rateLimitKey = `ratelimit:${clientIP}`;
  const now = Date.now();
  const newAttempts = currentAttempts + 1;

  try {
    if (newAttempts >= CONSTANTS.MAX_FAILED_ATTEMPTS) {
      // Block for specified duration
      const resetAt = now + (CONSTANTS.BLOCK_DURATION_MINUTES * 60 * 1000);
      await env.KV.put(rateLimitKey, JSON.stringify({
        attempts: newAttempts,
        resetAt
      }), { expirationTtl: CONSTANTS.RATE_LIMIT_TTL_SECONDS });
    } else {
      // Just increment attempts
      await env.KV.put(rateLimitKey, JSON.stringify({
        attempts: newAttempts,
        resetAt: now + (CONSTANTS.BLOCK_DURATION_MINUTES * 60 * 1000)
      }), { expirationTtl: CONSTANTS.RATE_LIMIT_TTL_SECONDS });
    }
  } catch (error) {
    console.warn('Failed to update rate limit data:', error.message);
  }
}

/**
 * Reset rate limit counter after successful authentication
 * @param {Object} env - Environment variables
 * @param {string} clientIP - Client IP address
 */
async function resetRateLimit(env, clientIP) {
  if (!env.KV) return;

  const rateLimitKey = `ratelimit:${clientIP}`;

  try {
    await env.KV.delete(rateLimitKey);
  } catch (error) {
    console.warn('Failed to reset rate limit counter:', error.message);
  }
}

/**
 * Fetch GitHub API with standard headers
 * @param {string} endpoint - GitHub API endpoint
 * @param {Object} env - Environment variables
 * @returns {Promise<Response>}
 */
async function fetchGitHubAPI(endpoint, env) {
  return fetch(`${CONSTANTS.GITHUB_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': CONSTANTS.GITHUB_API_VERSION,
      'User-Agent': CONSTANTS.USER_AGENT
    }
  });
}

// Constant-time string comparison to prevent timing attacks
async function timingSafeEquals(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CONSTANTS.CORS_HEADERS });
    }

    const url = new URL(request.url);
    const password = request.headers.get('X-Password');
    const clientIP = getClientIP(request);

    // Check rate limiting
    const rateLimitCheck = await checkRateLimit(env, clientIP);
    if (rateLimitCheck.isBlocked) {
      return createJSONResponse({
        error: 'Too many failed attempts. Try again later.',
        retryAfter: rateLimitCheck.retryAfter
      }, {
        status: 429,
        headers: {
          'Retry-After': rateLimitCheck.retryAfter.toString()
        }
      });
    }

    // Verify password with constant-time comparison
    const isValidPassword = await timingSafeEquals(password || '', env.VIEWER_PASSWORD);

    if (!isValidPassword) {
      // Get current attempts for rate limiting update
      let currentAttempts = 0;
      if (env.KV) {
        try {
          const rateLimitKey = `ratelimit:${clientIP}`;
          const rateLimitData = await env.KV.get(rateLimitKey);
          if (rateLimitData) {
            currentAttempts = JSON.parse(rateLimitData).attempts || 0;
          }
        } catch (error) {
          console.warn('Failed to get current attempts:', error.message);
        }
      }

      // Update rate limit counter
      await updateRateLimit(env, clientIP, currentAttempts);

      return createJSONResponse({ error: 'Invalid password' }, { status: 401 });
    }

    // Password is valid, reset rate limit counter
    await resetRateLimit(env, clientIP);

    // Route: GET /releases - List all releases
    if (url.pathname === '/releases') {
      const response = await fetchGitHubAPI(`/repos/${env.REPO_NAME}/releases`, env);
      const data = await response.json();

      return createJSONResponse(data, {
        headers: { 'Cache-Control': CONSTANTS.RELEASES_CACHE_CONTROL }
      });
    }

    // Route: GET /download-url/:assetId - Get download URL for an asset
    if (url.pathname.startsWith('/download-url/')) {
      const assetId = url.pathname.split('/download-url/')[1];

      // Get asset download URL from GitHub
      const assetResponse = await fetch(
        `${CONSTANTS.GITHUB_API_BASE}/repos/${env.REPO_NAME}/releases/assets/${assetId}`,
        {
          headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/octet-stream',
            'User-Agent': CONSTANTS.USER_AGENT
          },
          redirect: 'manual' // Get the redirect URL
        }
      );

      // GitHub returns 302 with Location header to the actual download URL
      if (assetResponse.status === 302) {
        const downloadUrl = assetResponse.headers.get('Location');
        return createJSONResponse({ downloadUrl }, {
          headers: { 'Cache-Control': CONSTANTS.DOWNLOAD_URL_CACHE_CONTROL }
        });
      }

      return createJSONResponse({ error: 'Asset not found' }, { status: 404 });
    }

    // Root: Return API info
    return createJSONResponse({
      name: 'GitHub Release Proxy',
      endpoints: {
        '/releases': 'List all releases',
        '/download-url/:assetId': 'Get download URL for an asset'
      },
      usage: 'Add X-Password header with your password'
    });
  }
};
