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
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Password',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    const url = new URL(request.url);
    const password = request.headers.get('X-Password');

    // Rate limiting: Check if IP is blocked (optional, requires KV binding)
    let rateLimitData = null;
    let rateLimitingEnabled = false;

    if (env.KV) {
      rateLimitingEnabled = true;
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                       request.headers.get('X-Forwarded-For') ||
                       request.headers.get('X-Real-IP') ||
                       'unknown';

      const rateLimitKey = `ratelimit:${clientIP}`;
      try {
        rateLimitData = await env.KV.get(rateLimitKey);

        if (rateLimitData) {
          const { attempts, resetAt } = JSON.parse(rateLimitData);
          const now = Date.now();

          if (now < resetAt) {
            // Still blocked
            const retryAfter = Math.ceil((resetAt - now) / 1000);
            return new Response(JSON.stringify({
              error: 'Too many failed attempts. Try again later.',
              retryAfter: retryAfter
            }), {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Retry-After': retryAfter.toString()
              }
            });
          }
        }
      } catch (error) {
        // Log KV error but continue without rate limiting
        console.warn('Rate limiting unavailable due to KV error:', error.message);
        rateLimitingEnabled = false;
      }
    } else {
      console.warn('Rate limiting disabled: KV namespace not configured. Consider setting up KV for enhanced security.');
    }

    // Verify password with constant-time comparison
    const isValidPassword = await timingSafeEquals(password || '', env.VIEWER_PASSWORD);

    if (!isValidPassword) {
      // Increment failed attempts (if rate limiting is enabled)
      if (rateLimitingEnabled) {
        try {
          const currentData = rateLimitData ? JSON.parse(rateLimitData) : { attempts: 0, resetAt: 0 };
          const newAttempts = currentData.attempts + 1;
          const now = Date.now();
          const clientIP = request.headers.get('CF-Connecting-IP') ||
                           request.headers.get('X-Forwarded-For') ||
                           request.headers.get('X-Real-IP') ||
                           'unknown';
          const rateLimitKey = `ratelimit:${clientIP}`;

          if (newAttempts >= 5) {
            // Block for 15 minutes
            const resetAt = now + (15 * 60 * 1000);
            await env.KV.put(rateLimitKey, JSON.stringify({
              attempts: newAttempts,
              resetAt: resetAt
            }), { expirationTtl: 900 }); // 15 minutes
          } else {
            // Just increment attempts, reset after 15 minutes
            await env.KV.put(rateLimitKey, JSON.stringify({
              attempts: newAttempts,
              resetAt: now + (15 * 60 * 1000)
            }), { expirationTtl: 900 });
          }
        } catch (error) {
          console.warn('Failed to update rate limit data:', error.message);
        }
      }

      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Password is valid, reset rate limit counter (if enabled)
    if (rateLimitingEnabled) {
      try {
        const clientIP = request.headers.get('CF-Connecting-IP') ||
                         request.headers.get('X-Forwarded-For') ||
                         request.headers.get('X-Real-IP') ||
                         'unknown';
        const rateLimitKey = `ratelimit:${clientIP}`;
        await env.KV.delete(rateLimitKey);
      } catch (error) {
        console.warn('Failed to reset rate limit counter:', error.message);
      }
    }

    // Route: GET /releases - List all releases
    if (url.pathname === '/releases') {
      const response = await fetch(
        `https://api.github.com/repos/${env.REPO_NAME}/releases`,
        {
          headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare-Worker'
          }
        }
      );

      const data = await response.json();
      
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    // Route: GET /download-url/:assetId - Get download URL for an asset
    if (url.pathname.startsWith('/download-url/')) {
      const assetId = url.pathname.split('/download-url/')[1];
      
      // Get asset download URL from GitHub
      const assetResponse = await fetch(
        `https://api.github.com/repos/${env.REPO_NAME}/releases/assets/${assetId}`,
        {
          headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/octet-stream',
            'User-Agent': 'Cloudflare-Worker'
          },
          redirect: 'manual' // Get the redirect URL
        }
      );

      // GitHub returns 302 with Location header to the actual download URL
      if (assetResponse.status === 302) {
        const downloadUrl = assetResponse.headers.get('Location');
        
        // Return the download URL to the client
        return new Response(JSON.stringify({ downloadUrl }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache' // Don't cache download URLs as they expire
          }
        });
      }

      return new Response(JSON.stringify({ error: 'Asset not found' }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Root: Return API info
    return new Response(JSON.stringify({
      name: 'GitHub Release Proxy',
      endpoints: {
        '/releases': 'List all releases',
        '/download-url/:assetId': 'Get download URL for an asset'
      },
      usage: 'Add X-Password header with your password'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
