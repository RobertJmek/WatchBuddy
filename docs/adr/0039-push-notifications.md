# ADR 0039 — Push notifications

**Status:** accepted · migration 0029 + app 1.33.0 (`expo-notifications`, a new native module)

## Context

Robert wanted everything that shows up as an in-app notification to also reach
the user as a push, if they allow it, on iOS and Android. Notifications already
have one source: the Postgres triggers on `review_replies`, `review_likes` and
`follows` write `notifications` (ADRs 0003, 0012), and they already skip a
blocked pair (0020). Research before building (Apple HIG, Android's
notification-permission guide, push-vendor guidance) agreed on:

- Ask in context, after explaining the value. iOS shows the system prompt
  once; a "Don't Allow" can only be undone in Settings.
- On Android 13+ the prompt needs a notification channel first. Channels are
  the user's per-type switches in system settings.
- Group instead of repeating: "Ana and 3 others liked your review" beats four
  pushes. Repeated pushes about one thing make people turn all of them off.
- Short, concrete copy. Per-type switches in the app, and an "Open Settings"
  path instead of switches when the system has said no.

## Decision

- **Every `notifications` row the triggers write is pushed**, from Postgres:
  `push_notification()` runs after insert, and after an update that raises
  `actor_count` (an aggregated like or follow). It builds the Expo messages in
  SQL and queues them with `pg_net` straight to the Expo Push API. There is no
  edge function. pg_net sends after commit and the whole send sits in an
  exception block, so a failing push never fails the like, reply or follow.
- **Likes and follows: at most one push per row per hour.** `notifications.pushed_at`
  records the last push. A like inside the hour only updates the in-app row, and
  the next push after the hour carries the total ("Dan and 2 others…"). Replies
  are one row each, and each one is pushed.
- **The copy is the in-app row's copy.** Reply: title "Ana replied to your
  review on Dune", body the reply text (whitespace collapsed, 150 characters).
  Like: "Ana and 3 others liked your review on Dune". Follow: "Ana followed you".
  A tap opens what the row opens: `/review/<ratingId>` or `/user/<actorId>`.
  The client accepts only those two shapes from `data.url`.
- **Grouping:** iOS `threadId` per review (`follows` for follows). Android
  channels `replies` (high importance), `likes` and `follows`. `collapseId` = the
  row id, so a newer push for the same row replaces the older one.
- **The iOS icon badge = the unread count**: sent with each push, and set by the
  app from the Feed's unread query. With the app open, no banner and no sound:
  the in-app badge is already live.
- **Tokens:** `push_tokens`, one row per phone (an Expo push token), with that
  phone's switches (`replies`, `likes`, `follows`). Per device on purpose: they
  sit next to the system permission they depend on. Rows are created only through
  `register_push_token`, which moves a token to the caller and resets its switches
  if another account held it, and keeps at most 10 tokens per account. The app
  re-registers on every signed-in start and deletes its row before signing out.
  Tokens unseen for 90 days stop receiving pushes.
- **The ask:** a new account gets a step between the profile step and the
  tutorial (`/allow-notifications`): two example notifications and "Turn on
  notifications", plus Skip. Our explanation comes first and the system prompt
  only after the tap. An existing account gets a card at the top of the
  Notifications segment (Turn on / Not now, gone for good on that install after
  either). Both appear only while the system hasn't been asked.
- **Settings:** Profile → Notifications. The three switches when allowed, "Turn
  on notifications" when the system hasn't been asked, "Open Settings" when it
  said no.
- **Enhanced push security:** if Vault holds `expo_access_token`, the trigger
  sends it as `Authorization: Bearer`, and Expo then refuses sends without it.
- **One EAS project for tokens:** the app asks for tokens for the `robertjmk`
  project (`cc64939c-…`, fixed in `push.ts`), which holds the APNs key and the
  FCM V1 service-account key. It is the account the EAS CLI is logged into and
  the iOS builds run under; `app.json` still names the `robertjmek` project,
  whose build quota is spent and whose credentials the CLI can't reach.

## Consequences

- Installed builds are unaffected: they register no token, so nothing is sent
  for them. Migration 0029 only adds things: a table, an RPC, a nullable column
  and triggers.
- iOS needs the Push Notifications capability on the App ID and a regenerated
  provisioning profile (the old one has no `aps-environment`), plus an APNs
  key. On Hagi's Individual account only he can create these. Android needs a
  Firebase project: `google-services.json` (kept in gitignored `credentials/`,
  since GitHub flags its API key) and an FCM V1 key uploaded to EAS.
- Tokens Expo reports as `DeviceNotRegistered` are not deleted. They age out
  after 90 days (`ponytail:` note in 0029). Read `net._http_response` if that
  ever matters.
- A like that arrives inside the hour is never pushed on its own. If nothing
  follows it, it stays in-app only.
- Privacy: the push token and the notification text go to Expo, then to Apple
  or Google, to be delivered.
