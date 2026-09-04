# Amar Sahayata — Secure + AI Ready

This package upgrades the previous verified August 2026 build.

### Included
- Existing Bengali public-help website and verified-source content.
- PWA install support.
- Secure server-side AI endpoint (`/api/ask`) plus multimodal AI Studio for vision, files, image generation, image editing and optional web/video integrations.
- Rate limiting and security headers.
- No browser-side AI secret/API key.
- Official-source automatic scanner (`updater.js`).
- Security and deployment guidance.

### Start
```bash
npm install
cp .env.example .env
# Fill AI_API_URL, AI_API_KEY, AI_MODEL and ALLOWED_ORIGIN on the server.
npm start
```

For source scanning:
```bash
npm run update
```

### Important
The site should not automatically publish arbitrary political claims. The updater monitors official government sources and prepares changes for verification. This protects ordinary users from fake news, impersonation sites, altered screenshots, and AI hallucinations.

The platform is independent and should remain politically neutral: monitor official government/department announcements regardless of which party or administration issued them.

### AI Studio
The AI Studio controls are embedded directly inside Amar Sahayata AI Mode. The existing site content and monetization tags are preserved. Image/file analysis, text-to-image, camera capture and downloads are handled in the browser through the Worker API. Image-edit prompts use the Cloudflare Workers AI `flux-1-kontext-dev` model when enabled.
