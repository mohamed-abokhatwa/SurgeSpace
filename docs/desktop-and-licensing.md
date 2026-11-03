# SurgeSpace: licensing and desktop apps

SurgeSpace licensing works like Engineering Workspace's, on its own server and database (nothing is shared):

| You (admin page, https://surgespace-licences.engspace.app/) | The customer (SurgeSpace app) |
|---|---|
| **Issue a licence**: name, email, personal or company (seats), paid until or perpetual → code `SSL-XXXX-XXXX-XXXX` | Licence → enters the code → **Activate**. The server records the computer (Machine ID, computer name, platform, version). |
| **Extend**: new end date. No new code needed. | The app checks in once a day and picks the new date up. |
| **Free the computer**: the licence can move | On the old computer the app is told at check-in; the code then activates elsewhere. |
| **Revoke / Restore** | Stops at the next check-in. |
| **Evaluations**: each computer by a one-way code; **Give 7 days / 14 / Set aside** | **Start 14-day evaluation**; **Ask for more evaluation time**: the first request adds 7 days by itself, later ones wait for you. |
| **Licence requests** (from the app and your website) → **Prepare the licence** fills the issue form | **Request a licence** (personal / company / question, name, email, message; Machine ID included). |
| **What people have told us** | **Tell us** button in the top bar (question, idea or problem). |

The key on a computer is signed by the server (Ed25519). The app checks it itself, so it works offline. The key runs at most
**60 days** ahead and moves forward at each daily check-in until the licence's end. A revoked or freed licence stops at
the next check-in, or within 60 days for a computer that stays offline. The app contains only the public key, so keys
cannot be forged or edited. Winding the clock back does not extend a key.

Plans in the app: **Free** (examples at any size, own models up to 25 pipes, no auto-sizing, uncertainty or export),
**Evaluation**, **Personal** and **Company** (everything).

## Live setup

- Server: Worker **surgespace-licence**, D1 database **surgespace-licences**, address
  **https://surgespace-licences.engspace.app** (admin page at the root). It is separate from Engineering Workspace's
  Worker `engspace-licences` on lic.engspace.app, which is not touched.
- The admin token and signing key are Worker secrets. To redeploy after code changes: `cd licence-server && npm run deploy`.

## Deploy from scratch (reference)

You need the Cloudflare account that hosts engspace.app. In `licence-server/`:

```bash
npm install
npx wrangler login
npx wrangler d1 create surgespace-licences      # copy the database_id into wrangler.toml
npm run db:remote                               # creates the tables
npx wrangler secret put ADMIN_TOKEN             # a long random password for the admin page
npx wrangler secret put LICENSE_PRIVATE_KEY     # 64 hex characters, see below
npm run deploy
```

Make the signing key on your computer (keep the private key only in Cloudflare and in your password manager):

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
```

Send the developer the **public key**:

```bash
cd .. && npx tsx -e "import {publicKeyOf} from './src/license/core'; publicKeyOf(process.argv[1]).then(console.log)" <private key>
```

It goes in `src/license/publicKey.ts` (`PUBLIC_KEY`). Until then the app runs in demo mode, with the server rules running
inside the app.

The Worker has its own hostname (custom domain in `wrangler.toml`), so it never shares a hostname with Engineering
Workspace. Open the admin page and enter the admin token.

Optional email notifications (licence requests, "more time" requests that wait for you, Tell us messages) use
[Resend](https://resend.com): `wrangler secret put RESEND_API_KEY`, `MAIL_TO` (your inbox) and `MAIL_FROM`
(a verified sender, e.g. `SurgeSpace <licence@engspace.app>`).

Your website's licence form can post to `https://surgespace-licences.engspace.app/request` with JSON
`{ kind: "personal" | "company" | "question", name, company, email, note, source: "website" }`.

## Desktop apps

- **Windows**: Microsoft Store, free listing. `.github/workflows/desktop.yml` builds the `.msix`; upload it in Partner
  Center (the Store signs it). Set the GitHub variables `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and
  `MSIX_PUBLISHER_DISPLAY` from Partner Center → Product identity.
- **Mac**: universal DMG. It is signed and notarized when the Apple secrets are set in GitHub (`APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- On the desktop the licence is also kept in the app's data folder, so it survives updates and reinstalling. The
  Machine ID comes from the operating system's machine id, hashed.

## Files

- `licence-server/`: Cloudflare Worker (`src/index.ts`), admin page (`src/admin.ts`), D1 storage and schema (`migrations/`).
- `src/license/server/logic.ts`: all server rules (shared by the Worker, the tests and the demo mode).
- `src/license/core.ts`: Machine ID, licence codes and signed keys.
- `src/license/licence.ts`, `LicenceDialog.tsx`: the app side (activation, daily check-in, evaluation, requests, Tell us).
- `src/license/publicKey.ts`: public key, server address, check-in interval.
- `tests/license.test.ts`: 60 tests, run on both an in-memory store and SQLite with the real D1 schema (`npm test`).
