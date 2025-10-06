# 🔐 PrivyLease

**A secure, password-protected web viewer for private GitHub releases powered by Cloudflare Workers**

Share your private GitHub releases with friends, team members, or testers without exposing your GitHub token or dealing with CORS issues. PrivyLease uses Cloudflare Workers to handle authentication server-side while providing direct CDN downloads for maximum speed and zero bandwidth cost.

### 🎯 Why PrivyLease?

**The Problem:** Sharing private GitHub releases is challenging. You can't give everyone your GitHub credentials, and embedding tokens in web pages exposes them to the world. Browser security restrictions (CORS) make direct API access difficult.

**The Solution:** PrivyLease acts as a secure middleman. Your Cloudflare Worker authenticates with GitHub using your private token, while users access releases through a simple password-protected web interface. Downloads happen directly from GitHub's CDN for maximum speed and zero bandwidth cost.

**Perfect For:** Beta testing, internal builds, game releases, private software distribution

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [🚀 Installation](#-installation)
- [🛠️ Usage](#️-usage)
- [📚 Documentation](#-documentation)
- [❓ Troubleshooting](#-troubleshooting)
- [💰 Costs & Limits](#-costs--limits)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)

---

## ✨ Features

🔒 **Password Protected** - Share with anyone using a simple password  
🔐 **Secure Token Storage** - GitHub token stays server-side (encrypted), never exposed to browsers  
⚡ **Direct CDN Downloads** - Files download directly from GitHub's CDN (no proxy overhead)  
💰 **Zero Bandwidth Cost** - Worker only handles authentication, not file transfers  
🚫 **No CORS Issues** - Worker handles all GitHub API authentication  
🆓 **Free Tier Friendly** - 100,000 requests/day on Cloudflare's free plan  
📱 **Beautiful UI** - Modern, responsive interface that works on all devices  
🌐 **Works Everywhere** - No browser restrictions or special requirements  
🔒 **HTTPS Only** - All traffic encrypted with Cloudflare SSL  
⚙️ **Easy Setup** - Deploy in 10 minutes with automated GitHub Actions workflow  

---

## 🚀 Installation

### Prerequisites

- A GitHub account with a private repository containing releases
- A Cloudflare account (free tier)
- A GitHub Personal Access Token with `repo` scope

### Step 1: Deploy Cloudflare Worker

1. **Create Cloudflare Account**
   - Go to https://workers.cloudflare.com/
   - Sign up for a free account and verify your email

2. **Create Worker**
   - Visit https://dash.cloudflare.com/
   - Click "Workers & Pages" in the sidebar
   - Click "Create application" → "Create Worker"
   - Name it `github-proxy` (or any name you prefer)
   - Click "Deploy"

3. **Add Worker Code**
   - Click "Edit code" on the worker page
   - Delete the default code
   - Copy and paste the entire contents of [`cloudflare-worker.js`](cloudflare-worker.js) from this repository
   - Click "Save and Deploy"

4. **Configure Environment Variables**
   - Go to "Settings" → "Variables"
   - Add the following variables:

   | Variable Name | Type | Value | Description |
   |--------------|------|-------|-------------|
   | `GITHUB_TOKEN` | Secret ✓ Encrypt | Your GitHub token | Token with `repo` scope |
   | `VIEWER_PASSWORD` | Secret ✓ Encrypt | Your chosen password | Password for accessing releases |
   | `REPO_NAME` | Variable | `username/repo` | Your GitHub repository path |

   - Click "Save and Deploy" after adding all variables

5. **Copy Worker URL**
   - Your worker URL will look like: `https://github-proxy.your-subdomain.workers.dev`
   - Save this URL - you'll need it in the next step

### Step 2: Deploy Viewer to GitHub Pages

1. **Fork or Clone This Repository**
   ```bash
   git clone https://github.com/yourusername/Privylease.git
   cd Privylease
   ```

2. **Add Repository Secret**
   - Go to your repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `CLOUDFLARE_WORKER_URL`
   - Value: Your Cloudflare Worker URL from Step 1
   - Click "Add secret"

3. **Enable GitHub Pages**
   - Go to your repository Settings → Pages
   - Under "Build and deployment":
     - Source: Select **GitHub Actions** (not "Deploy from a branch")
   - Click "Save"
   - **Important:** This must be set to "GitHub Actions" for the automated deployment to work

4. **Deploy**
   - The GitHub Actions workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) will automatically:
     - Configure the `index.html` with your Cloudflare Worker URL
     - Deploy the viewer to GitHub Pages
   - Go to Actions tab to monitor the deployment
   - Once complete, your viewer will be available at: `https://yourusername.github.io/Privylease/`

### Step 3: Share with Users

Share the following with your users:
- **Viewer URL:** `https://yourusername.github.io/Privylease/`
- **Password:** The password you set in `VIEWER_PASSWORD`

That's it! Users can now access your private releases securely.

---

## 🛠️ Usage

### For End Users (Viewing & Downloading Releases)

1. **Access the Viewer**
   - Open the GitHub Pages URL shared with you
   - Example: `https://username.github.io/Privylease/`

2. **Enter Password**
   - Enter the password provided by the administrator
   - Click "Unlock"

3. **Browse Releases**
   - View all available releases with their details
   - See release dates, version tags, and file information

4. **Download Files**
   - Click the "Download" button next to any file
   - The download will start directly from GitHub's CDN
   - No account or authentication required!

### For Administrators

#### Adding New Releases
Simply create releases in your private GitHub repository as usual. They will automatically appear in the viewer.

#### Changing Password
1. Go to your Cloudflare Worker dashboard
2. Settings → Variables
3. Edit `VIEWER_PASSWORD`
4. Click "Save and Deploy"
5. Share the new password with users

#### Changing Repository
1. Go to your Cloudflare Worker dashboard
2. Settings → Variables
3. Edit `REPO_NAME` to point to a different repository
4. Click "Save and Deploy"

#### Using a Custom Domain
1. Add your domain to Cloudflare
2. In Worker dashboard: Go to "Triggers"
3. Click "Add Custom Domain"
4. Enter your domain (e.g., `releases.yourdomain.com`)
5. Update the `CLOUDFLARE_WORKER_URL` secret in your GitHub repository
6. Re-run the GitHub Actions deployment

### Testing

#### Test Worker API
```bash
# Test without password (should return 401)
curl https://your-worker.workers.dev/releases

# Test with password (should return releases JSON)
curl -H "X-Password: YourPassword123" \
     https://your-worker.workers.dev/releases

# Get download URL for a specific asset
curl -H "X-Password: YourPassword123" \
     https://your-worker.workers.dev/download-url/ASSET_ID
```

#### Test Web Interface
1. Open your GitHub Pages URL
2. Enter password and click "Unlock"
3. Verify releases are displayed
4. Click a download button
5. Verify file downloads successfully

---

## 📚 Documentation

### How It Works

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Browser   │────────>│ Cloudflare Worker│────────>│   GitHub    │
│  (Client)   │         │   (Auth Only)    │         │     API     │
└─────────────┘         └──────────────────┘         └─────────────┘
      │                          │                            │
      │  1. Request with         │  2. Authenticate with      │
      │     password             │     GitHub token           │
      │                          │                            │
      │  3. Get download URL     │                            │
      │<─────────────────────────┤                            │
      │                          │                            │
      │  4. Direct download from GitHub CDN                   │
      │<──────────────────────────────────────────────────────┘

✅ Token never leaves Cloudflare Worker
✅ Password validated server-side
✅ No worker bandwidth usage - direct CDN downloads
✅ Faster downloads - no proxy overhead
```

**Key Points:**
- The browser never sees your GitHub token
- Authentication happens on Cloudflare's servers
- Downloads are direct from GitHub's CDN (no proxy)
- Worker only provides the authenticated download URL
- URLs expire after a few minutes for security

### API Reference

The Cloudflare Worker exposes the following endpoints:

#### GET `/releases`
Returns a list of all releases from the configured repository.

**Headers:**
- `X-Password`: Your viewer password

**Response:**
```json
[
  {
    "id": 123456,
    "name": "v1.0.0",
    "tag_name": "v1.0.0",
    "published_at": "2025-01-01T00:00:00Z",
    "assets": [
      {
        "id": 789,
        "name": "app-release.apk",
        "size": 52428800
      }
    ]
  }
]
```

#### GET `/download-url/:assetId`
Gets an authenticated download URL for a specific asset.

**Headers:**
- `X-Password`: Your viewer password

**Response:**
```json
{
  "downloadUrl": "https://objects.githubusercontent.com/..."
}
```

**Note:** Download URLs expire after a few minutes (GitHub security feature).

### Architecture

**Components:**
1. **Cloudflare Worker** (`cloudflare-worker.js`) - Handles authentication and GitHub API requests
2. **HTML Viewer** (`index.html`) - Beautiful web interface for browsing and downloading releases
3. **GitHub Actions** (`.github/workflows/deploy.yml`) - Automates deployment to GitHub Pages

**Security Features:**
- Password validation on every request
- GitHub token stored as encrypted Cloudflare secret
- HTTPS-only communication
- Rate limiting provided by Cloudflare
- No token exposure to browser/client
- Download URLs are time-limited by GitHub

---

## ❓ Troubleshooting

### "Invalid password" Error

**Symptoms:** Getting "Invalid password" even though the password is correct.

**Solutions:**
- Verify `VIEWER_PASSWORD` is spelled correctly in Cloudflare (case-sensitive)
- Passwords are case-sensitive - check for typos
- Click "Save and Deploy" after changing variables
- Clear browser cache and try again

### "Failed to fetch releases" Error

**Symptoms:** Cannot load releases in the viewer.

**Solutions:**
- Verify `GITHUB_TOKEN` is set correctly in Cloudflare
- Ensure token has `repo` scope (check at https://github.com/settings/tokens)
- Check `REPO_NAME` format is `username/repo` (no spaces, no URL)
- Test your token manually:
  ```bash
  curl -H "Authorization: token YOUR_TOKEN" \
       https://api.github.com/repos/username/repo/releases
  ```
- Check Cloudflare Worker logs for detailed errors

### Downloads Not Working

**Symptoms:** Download button doesn't work or fails.

**Solutions:**
- Check Cloudflare Worker logs in the dashboard
- Verify the asset exists in your GitHub release
- Download URLs expire after a few minutes - try getting a fresh URL
- Test the download endpoint:
  ```bash
  curl -H "X-Password: YourPassword" \
       https://your-worker.workers.dev/download-url/ASSET_ID
  ```
- Check if GitHub is experiencing issues

### Worker Not Responding

**Symptoms:** Viewer shows connection errors.

**Solutions:**
- Verify worker is deployed (check Cloudflare dashboard)
- Confirm worker URL is correct in `CLOUDFLARE_WORKER_URL` secret
- Check "Real-time Logs" in worker dashboard for errors
- Ensure worker route/domain is configured properly
- Try redeploying the worker

### GitHub Pages Not Updating

**Symptoms:** Changes not reflected on the live site.

**Solutions:**
- Check GitHub Actions tab for deployment status
- Verify `CLOUDFLARE_WORKER_URL` secret is set correctly
- Re-run the workflow manually from Actions tab
- Check that Pages is enabled with source set to "GitHub Actions"
- Wait a few minutes - GitHub Pages can take time to update

### Need More Help?

- **Check Worker Logs:** Cloudflare Dashboard → Your Worker → Logs
- **Check GitHub Actions:** Repository → Actions tab
- **Test with cURL:** Use the commands in the [Testing](#testing) section
- **GitHub Resources:**
  - Token scopes: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
  - API docs: https://docs.github.com/en/rest
- **Cloudflare Resources:**
  - Dashboard: https://dash.cloudflare.com/
  - Docs: https://developers.cloudflare.com/workers/

---

## 💰 Costs & Limits

### Cloudflare Workers Free Tier

- **Requests:** 100,000 per day
- **CPU Time:** 10ms per request
- **Scripts:** Up to 30 workers
- **Worker Bandwidth:** Not used (direct CDN downloads)
- **Perfect for:** Personal projects, small teams, beta testing

### Typical Usage Example

For a small team (10 people) with 5 releases:
- **Daily requests to worker:** ~200-500
- **Worker bandwidth:** $0 (downloads are direct from GitHub CDN)
- **Cost:** $0 (well within free tier)

### When You Might Need Paid Plan

Cloudflare Workers Paid Plan ($5/month):
- **Requests:** 10 million per month
- **CPU Time:** 50ms per request
- Useful for: Large teams, high-traffic public releases

### GitHub Free Tier

- **Private repositories:** Unlimited
- **GitHub Actions:** 2,000 minutes/month
- **GitHub Pages:** Free hosting
- **Release storage:** Unlimited
- **Bandwidth:** Unlimited for release downloads

**Bottom Line:** Most users will stay completely free! 🎉

---

## 🤝 Contributing

Contributions are welcome! Whether you're fixing bugs, improving documentation, or adding new features, your help makes PrivyLease better for everyone.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes and commit**
   ```bash
   git commit -m 'Add amazing feature'
   ```
4. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request**

### Ideas for Contributions

- 🎨 UI/UX improvements
- 🔒 Additional security features
- 📱 Mobile app or native integrations
- 🌍 Internationalization (i18n)
- 📊 Usage analytics
- 📝 Documentation improvements
- 🐛 Bug fixes

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Cloudflare Workers** - For providing an excellent serverless platform with a generous free tier
- **GitHub** - For their robust API, CDN infrastructure, and free hosting via GitHub Pages
- **The Open Source Community** - For inspiration, best practices, and continuous support

Special thanks to everyone who has contributed to making PrivyLease better!

---

Made with ❤️ for secure and easy private release sharing
