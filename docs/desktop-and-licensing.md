# SurgeSpace: desktop apps and licensing

## How licensing works

| Where the user runs SurgeSpace | How they pay | How the app knows |
|---|---|---|
| Windows (Microsoft Store only) | Store subscription add-on "SurgeSpace Pro" (with a free trial set in Partner Center) | Windows Store licence, read by the app (`src-tauri/src/lib.rs`) |
| Mac (download from engspace.app) | Licence key bought on the website | Signed token from the SurgeSpace licence server |
| Browser (engspace.app/surgespace) | Same licence key | Same signed token |

Plans: **Free** (examples at any size; own models up to 25 pipes; no auto-sizing, uncertainty or export), **Trial** (14 days of Pro, email required, one per person and per computer), **Pro** (everything, 2 computers per key), **Enterprise** (same features, more seats).

Licence keys look like `SSPC-XXXXX-XXXXX-XXXXX-XXXXX`; a check character catches typing mistakes. When a key is activated, the server returns a token signed with an Ed25519 key and bound to that computer. The app checks the token itself, so it works offline. It refreshes the token quietly every 7 days and must be online at least once every 30 days. A cancelled or expired licence therefore stops within 30 days at most. The server stores only a SHA-256 hash of each key.

Files:
- `supabase/functions/_shared/licenseCore.ts`: token signing and checking, keys, plan features, and all server rules. The app and the server share this file.
- `supabase/functions/licence/index.ts`: the licence server (Supabase Edge Function).
- `supabase/migrations/20261103000000_licensing.sql`: tables `ss_licenses`, `ss_activations` and `ss_trials`. Only the server can read them.
- `src/license/`: the licence state in the app and the Licence dialog.
- `scripts/licence-admin.ts`: create the signing key, issue, revoke and list licences.
- `tests/license.test.ts`: 26 tests, run with `npm test`.

Builds without a licence server configured (such as the preview) use a demo licence server inside the browser, so every step can be tried.

## Your steps

### 1. Licence server (about 15 minutes, once)

1. Choose the Supabase project. A new "engspace" project is cleanest, and it can later hold the website accounts too.
2. Create the signing key on your own computer and keep the secret file safe:
   ```bash
   npx tsx scripts/licence-admin.ts keygen surgespace-licence.key
   ```
3. Deploy:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   supabase secrets set LICENSE_PRIVATE_KEY=$(cat surgespace-licence.key)
   supabase functions deploy licence --no-verify-jwt
   ```
4. Set the build variables, in GitHub → Settings → Secrets and variables → Actions → Variables, and in `.env.production` for web builds:
   - `VITE_LICENSE_API` = `https://<ref>.supabase.co/functions/v1/licence`
   - `VITE_LICENSE_PUBKEY` = the public key printed in step 2
   - `VITE_BUY_URL` = your purchase page, for example `https://engspace.app/surgespace`
5. Issue a licence:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/licence-admin.ts issue --email client@firm.com --name "Firm Ltd" --seats 2 --years 1
   ```
   Later, a payment provider's webhook can call the same insert automatically. Paddle and Lemon Squeezy act as merchant of record and handle VAT and sales tax worldwide.

### 2. Microsoft Store (Windows)

1. Register in Partner Center (https://partner.microsoft.com) as a company or individual developer.
2. Reserve the name **SurgeSpace**. Under Product identity, copy *Package/Identity/Name*, *Publisher* (CN=…) and *Publisher display name* into the GitHub variables `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_DISPLAY`.
3. Pricing: set the app to **Free**. Create an add-on of type **Subscription** called "SurgeSpace Pro", monthly or yearly, with a free trial (for example 14 days). Put its Store ID (for example `9NXXXXXXXXXX`) in the GitHub variable `STORE_PRO_ADDON_ID`.
4. Run the "Desktop builds" workflow. Download `SurgeSpace-MicrosoftStore` and upload the `.msix` in Partner Center. The Store signs it, so you don't need a code-signing certificate.

### 3. Mac

1. Join the Apple Developer Program, then create a "Developer ID Application" certificate.
2. Add the GitHub secrets `APPLE_CERTIFICATE` (the .p12 as base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`.
3. Run the workflow and download `SurgeSpace-macOS` (a universal DMG for Apple silicon and Intel). Host it on engspace.app.

Without the Apple secrets the workflow still builds an unsigned DMG for testing. macOS will warn when opening it.
