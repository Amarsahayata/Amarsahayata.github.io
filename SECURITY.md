# Amar Sahayata — Security & Auto-Update Architecture

## What was hardened
- Security headers via Helmet: CSP, frame-ancestors, referrer policy, no MIME sniffing.
- No API key is placed in HTML, JavaScript, the PWA, or the public repository.
- API request body is capped at 20 KB.
- AI endpoint is rate-limited.
- AI endpoint blocks obvious attempts to submit OTP/PIN/password/CVV/Aadhaar/bank secrets.
- Service worker never caches `/api/*`, reducing the chance of stale/private API responses being stored.
- Same-origin API by default; optional exact `ALLOWED_ORIGIN`.
- `x-powered-by` is disabled.
- Static dotfiles are denied.
- Government information is treated as untrusted until it is verified against an official source.

## Automatic government-information updates
The included `updater.js` polls only official Government of West Bengal / Government of India / PIB / official department portals.

Recommended production flow:
1. Run `npm run update` on a server cron every 30–60 minutes.
2. Store the fetched source snapshot in a database/object store.
3. Hash each source and detect changes.
4. Send changed official-source text to the AI backend for a plain-language draft.
5. Run verification rules: official domain allowlist, source URL, publication date, scheme/entity match.
6. Put the result in a review queue.
7. Publish only verified records.
8. Keep the original official URL and timestamp visible to users.

This is intentionally NOT an "AI can publish anything automatically" system. That would be unsafe for ordinary users because an official page can change, contain incomplete information, or be temporarily unavailable. The safe design is automatic detection + AI summarization + verification gate.

## Deployment requirements
- Use HTTPS only.
- Put Node behind a reverse proxy such as Nginx/Caddy/Cloudflare.
- Set a strong random `UPDATE_SECRET` if you expose an update trigger.
- Use a managed database for the update/review queue.
- Back up the published data and audit log.
- Never collect Aadhaar/OTP/password/PIN/CVV in Amar Sahayata's own forms.
- If documents are ever uploaded, use private object storage, malware scanning, strict file-type/size limits, short-lived signed URLs, and automatic deletion rules.

## PWA / Android
This build remains installable as a PWA. It can be packaged into an Android app later using a trusted wrapper (for example, Trusted Web Activity) without putting the AI key inside the Android app.
