# ADR 0027 — Sign in with Apple

**Status:** accepted · targets v1.24.0

## Context

App Store Review Guideline 4.8: an app that offers a third-party login
(Google) must also offer an equivalent one that limits collection to name and
email and lets the user hide their email. The email one-time code does not
hide the address, so WatchBuddy needed Sign in with Apple before its first App
Store submission. `signInWithProvider` already typed `'apple'`, but nothing
called it.

The same submission exposed a sign-in trap on iOS (the number pad hid
"Verify & sign in"). That fix shipped on its own in v1.23.10 (PR #103) and is
not part of this decision.

## Decision

- **Native, not web OAuth.** `expo-apple-authentication` shows the system
  sheet; its identity token goes to `supabase.auth.signInWithIdToken`. The
  browser round trip Google uses would show an Apple web login inside an app
  running on an iPhone that is already signed in to Apple.
- **iOS only.** The button renders when `Platform.OS === 'ios'` and
  `isAvailableAsync()`. The guideline is App Store only; Android keeps Google +
  email.
- **Apple's own button** (`AppleAuthenticationButton`, *Continue*), above
  Google, white on dark and black on light. Apple's HIG requires its button and
  reviewers check.
- **No nonce.** Supabase checks a nonce only when the token carries one;
  skipping it avoids a crypto dependency. Revisit if Supabase starts requiring it.
- **The full name Apple returns on first sign-in is not stored.** Onboarding
  already asks for a display name and username.

## Setup outside the repo

- Apple Developer portal: *Sign in with Apple* enabled on the App ID
  `com.robertjmek.watchbuddy`, and the App Store provisioning profile
  regenerated. The old profile lacks the entitlement and the build fails to sign.
- Supabase: Auth → Providers → Apple enabled, Client IDs =
  `com.robertjmek.watchbuddy`. The native flow needs no secret key.

## Consequences

- New native dependency, so a new binary.
- **Known gap:** Guideline 5.1.1(v) asks an app with Sign in with Apple to
  revoke the user's Apple tokens when the account is deleted. `delete-account`
  does not, because that needs a Sign in with Apple key (.p8) from the account
  holder. Add it if review asks or when the key is available.
