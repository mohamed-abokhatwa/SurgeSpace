# Start here: Mohamed's three apps

Give this file, plus the three HANDOVER.md files, to a new conversation. No secrets are in these files.

## The apps

| App | What | Repository | Status |
|---|---|---|---|
| **SurgeSpace** | Water hammer / surge analysis (web + Windows Microsoft Store + Mac) | mohamed-abokhatwa/SurgeSpace | MSIX 1.0.9.0 ready for the Microsoft Store; Mac waits for Apple account |
| **Planet of Engineers** | Mobile app for engineers and students (tools, Q&A, salaries, Campus, moderation) | mohamed-abokhatwa/planet-of-engineers | Android 1.1.0 build 3 ready for Google Play; database live |
| **Bil-Ghayb** | Mobile app: make dua for a stranger in secret | mohamed-abokhatwa/bilghayb | Android 1.0.0 build 3 ready for Google Play; backend live |

Each repository has a `HANDOVER.md` with the full feature list, architecture, tests and open items.

## Accounts and services (names only)

- GitHub: mohamed-abokhatwa (the three repositories above).
- Expo / EAS: account **abokhatwa** (projects planet-of-engineers and bilghayb).
- Supabase: projects **planet-of-engineers** (`iflatdqhvnxedipcxuab`) and **bilghayb** (`gbwauitktbtiwsmozvhr`), free plan.
- Cloudflare (SurgeSpace licensing only): Worker `surgespace-licence`, D1 `surgespace-licences`,
  host surgespace-licences.engspace.app. **Never touch Engineering Workspace** (Worker `engspace-licences`, lic.engspace.app).
- Microsoft Partner Center: SurgeSpace, Store ID 9NFRBFGTQBSK (publisher Engineering Workspace).
- Google Play Console: Planet of Engineers and Bil-Ghayb (new personal account).
- Apple Developer: not active yet.
- Public pages: abokhatwa.com/planet-of-engineers/ and abokhatwa.com/Bilghayb/ (GitHub Pages).

## Working rules (keep these)

- Never paste keys or tokens into chat. They go in GitHub secrets, EAS env vars, Supabase secrets or the session's
  secure credential form.
- Commits: `git -c user.email=mohamed.abokhatwa@hotmail.com -c user.name="Mohamed"`; end messages with the
  attribution lines the system gives; no AI model names in commits.
- Keep SurgeSpace and Engineering Workspace separate.
- Test thoroughly before shipping. Accuracy is critical for the engineering apps (run the full check scripts).
- Database changes: run the local Postgres tests first; migrations must keep old app versions working.
- Planet of Engineers owner: run `select public.set_owner('abokhatwa');` only after the owner creates that username.

## Google Play: steps for both apps (new personal account)

Do these for **Planet of Engineers** (`com.abokhatwa.planetofengineers`, file `planet-of-engineers-1.1.0-build3.aab`) and
**Bil-Ghayb** (`com.abokhatwa.bilghayb`, file `bilghayb-1.0.0-build3.aab`).

1. **Create the app** (if not done): Play Console → Create app → name, default language, App, Free, accept declarations.
2. **Finish setting up the app** (Dashboard → "Finish setting up your app"; texts are in each repo's store listing file):
   - Privacy policy: the app's `/privacy.html` link.
   - App access: "All functionality is available without special access" (anonymous sign-in, no login).
   - Ads: No. Content rating: fill in the questionnaire (Planet of Engineers 12+, Bil-Ghayb Teen/12+).
   - Target audience: 13 and over. Data safety: copy the answers from the listing file.
   - Government apps, financial, health, news: No. Category: Planet of Engineers → Productivity (or Education);
     Bil-Ghayb → Lifestyle.
   - Store listing: name, short and full description, icon 512×512, feature graphic 1024×500, phone screenshots.
3. **Internal testing** (optional, quick check): Testing → Internal testing → Create release → upload the `.aab` →
   add your own Gmail as tester → install from the opt-in link.
4. **Closed testing (required)**: Testing → Closed testing → Create track → upload the same `.aab` → add at least
   **12 testers** (email list or a Google Group) → countries → Review and roll out. Send testers the opt-in link; they
   must stay opted in for **14 days in a row**.
5. **Apply for production** after 14 days (Dashboard → Apply for production; answer the questions about the test).
6. **Production release**: Production → Create release → upload (or promote) the `.aab` → release notes → roll out.

Play App Signing: accept Google's default when asked (EAS keeps the upload key).

## Open items across apps

- Microsoft Store: upload SurgeSpace 1.0.9.0 with the updated listing.
- Google Play: steps above for both apps.
- Apple: Developer account → secrets in GitHub → iOS workflows (Planet of Engineers, Bil-Ghayb) and Mac notarization
  (SurgeSpace).
- Revoke the Cloudflare token that was pasted in an old chat.
