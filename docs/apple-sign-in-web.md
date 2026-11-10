# Sign in with Apple on the web

The iOS app signs in with Apple natively (`@capacitor-firebase/authentication`) and needs none of this. The **web** app uses Firebase's Apple OAuth flow in a popup (`AuthService.signInWithApple` → `signInWithPopup(new OAuthProvider('apple.com'))`), and that flow only works after the steps below. Until then the button shows on the web and the popup fails with `auth/operation-not-allowed`.

Nothing here goes in the repository: the key file and its ids are typed into the Firebase console only.

## 1. Apple Developer (developer.apple.com → Certificates, Identifiers & Profiles)

1. **App ID** — the app's existing identifier already has "Sign in with Apple" enabled (the iOS app uses it). Note your **Team ID** (top right of the page / Membership).
2. **Services ID** — Identifiers → `+` → *Services IDs*. This is the OAuth client id for the web.
   - Enable *Sign in with Apple* and click *Configure*.
   - Primary App ID: the app's App ID.
   - Domains and Subdomains: `bible-audio-ab851.firebaseapp.com`
   - Return URLs: `https://bible-audio-ab851.firebaseapp.com/__/auth/handler`
3. **Key** — Keys → `+` → enable *Sign in with Apple* → *Configure* → choose the App ID. Download the `.p8` file (it can be downloaded only once) and note its **Key ID**.

## 2. Firebase console (Authentication → Sign-in method → Apple)

1. Enable the provider.
2. **Services ID**: the identifier created in step 1.2.
3. **OAuth code flow configuration**: Apple **Team ID**, **Key ID**, and the contents of the `.p8` **private key**.
   This part is also what lets account deletion revoke the app's Apple tokens (`revokeAccessToken` in `AuthService.deleteAccount`).
4. The callback URL Firebase shows must be the Return URL from step 1.2.

## 3. Authorized domains (Authentication → Settings → Authorized domains)

Both sites must be listed, as they already are for Google sign-in:

- `bible-audio2.vercel.app`
- `biblia-narrada.vercel.app`

## Checking it

- Web, signed out: Settings shows "Sign in with Apple" above "Sign in with Google"; the popup completes and the account name appears.
- Web, signed in with Apple: "Delete my account" opens an **Apple** popup to confirm (not Google), then removes the account and its synced plans.
- Android app: only the Google button shows.
- iOS app: unchanged (native sheet).

## Notes

- Apple lets the user hide their e-mail; the account then has a `privaterelay.appleid.com` address and possibly no display name. Settings falls back to the e-mail when there is no name.
- Popup, not redirect, for the same reason as Google: the redirect flow depends on storage surviving a round trip through `firebaseapp.com`, which browser storage partitioning breaks.
