# SurgeSpace: desktop apps and licensing

## Licensing process (same as Engineering Workspace, kept separate from it)

1. The user opens **Licence** (the plan badge next to the SurgeSpace name) and sees the computer's **Machine ID**,
   e.g. `SS-7K3Q-M9XD-2WPA-H4TN`. "Open email" prepares a message to licence@engspace.app.
2. You open **tools/licence-tool.html** on your own computer, paste the Machine ID, choose the plan and duration,
   and press *Make activation code*. "Copy reply email" gives a ready answer with the code and instructions.
3. The user pastes the code in SurgeSpace and presses *Activate*. It works only on that computer, until its last day.
4. **Periodic online check:** every 3 days (when online) SurgeSpace downloads
   `https://lic.engspace.app/surgespace/status.txt`. If the licence number is listed as cancelled, the licence stops.
   SurgeSpace keeps working offline for up to 30 days without a successful check, then falls back to Free until it
   can connect. (The 3 and 30 days are set in `src/license/publicKey.ts`.)

Plans: **Free** (examples at any size, own models up to 25 pipes, no auto-sizing, uncertainty or export),
**Trial** (14 days, started in the app, once per computer), **Pro** and **Enterprise** (everything).

Why codes cannot be faked: each code is signed with your private key (Ed25519). The app contains only the public
key, which can check a code but cannot make one, so the app can be taken apart without anyone being able to
make codes. Editing a code (for example its end date) breaks the signature. Winding the computer clock back does
not extend a licence or trial: the app remembers the latest date it has seen.

## One-time setup

1. Open `tools/licence-tool.html` (double-click; it works offline in Chrome or Edge).
2. Press **Create a new signing key**. A file `surgespace-signing-key.txt` downloads. Keep it safe, with a backup
   copy (e.g. encrypted USB stick and your password manager). Never email it. Anyone with it can make licences.
3. Send the **public key** shown in the tool to your developer. It goes in `src/license/publicKey.ts`
   (`PUBLIC_KEY`). Until then the app runs in demo mode, where it can make demo codes for itself.
4. Check that `LICENCE_EMAIL` and `STATUS_URL` in the same file are right.
5. On lic.engspace.app create the folder `surgespace/` and upload `status.txt` from the tool (*Make status file
   for the website*). The server must send the header `Access-Control-Allow-Origin: *` for that file, so the
   app can read it.

## Day to day

- **New licence:** paste the Machine ID → *Make activation code* → *Copy reply email* → send.
- **Renewal:** make a new code for the same Machine ID with the new duration; the customer pastes it.
- **New computer:** make a code for the new Machine ID, and cancel the old licence if needed.
- **Cancel (refund, misuse):** *Cancel* in the register → *Make status file* → upload `status.txt` to the website.
- **Backup:** *Export CSV* regularly. The register lives in the tool's browser storage on that computer.

## Desktop apps

- **Windows:** Microsoft Store only, listed as a free app. The workflow `.github/workflows/desktop.yml` builds the
  `.msix` package, which you upload in Partner Center. The Store signs it. Set the GitHub variables
  `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_DISPLAY` from Partner Center → Product identity.
- **Mac:** universal DMG (Apple silicon and Intel). It is signed and notarized when the Apple secrets are set in
  GitHub (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`); without them it builds an unsigned test DMG. Host it on engspace.app.
- On the desktop, the licence is also saved in the app's data folder, so it survives updates and reinstalling.

## Files

- `src/license/core.ts`: Machine ID, signed activation codes and status file (shared by the app and the tool).
- `src/license/licence.ts`, `LicenceDialog.tsx`: licence state, trial, online check and the Licence dialog.
- `src/license/publicKey.ts`: public key, licence email, status file address, check intervals.
- `tools/licence-tool/`: the licence tool source; `npm run licence-tool` rebuilds `tools/licence-tool.html`.
- `tests/license.test.ts`: 19 tests (`npm test`).
