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

    // Verify password
    if (password !== env.VIEWER_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
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
