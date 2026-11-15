# ADR 0036 — Write budgets: a ceiling on how fast one account can write

**Status:** accepted · backend only (migration 0027), no app release

## Context

The 2026-11-15 security review found that nothing bounds how much one signed-in
account can write. Row-level security decides whose rows an account may write,
not how many, and the Data API has no rate limit of its own. With a session and
the public key, one account could:

- post replies without limit (each is a notification for its target), or loop
  follow / unfollow and like / unlike to keep re-raising a notification the
  target had dismissed;
- fill the database through the tables with no natural bound:
  `episode_watches` and `movie_watches` have no unique key, and
  `ratings.entity_id` and `reports.target_id` have no foreign key.

Blocking stops one known account. It does nothing against volume.

## Decision

- **Token buckets in Postgres, per account and per kind of write**, reusing
  `rate_limits` and `consume_rate_limit` (0018, ADR 0016) rather than adding a
  second mechanism.
- **Enforced by a statement-level `AFTER INSERT` trigger** on each table, so it
  holds for every installed build and for direct API calls alike. A statement
  costs its row count: an import chunk of 500 is one spend of 500.
- **The subject is always `auth.uid()`**, never a value from the row. The
  service role and the Dashboard have no uid and are not metered.
- **Only new rows cost.** Updates and deletes are free, and so is an upsert that
  lands on an existing row, so changing a rating never spends.
- **Over budget, the whole statement fails** with SQLSTATE `PT429`, which
  PostgREST returns as HTTP 429 with "Too many requests. Try again later.".
- **Fails open.** If the limiter itself errors, the write goes through, as in
  `tmdb-proxy`. A broken accountant must not stop every write in the app.

Budgets (Robert's numbers):

| bucket | tables | burst | refill |
|---|---|---|---|
| `w:replies` | `review_replies` | 30 | 30 / hour |
| `w:follows` | `follows` | 100 | 100 / hour |
| `w:likes` | `review_likes` | 200 | 200 / hour |
| `w:reports` | `reports` | 30 | 30 / day |
| `w:watches` | `episode_watches` + `movie_watches` | 100,000 | 20,000 / day |
| `w:ratings` | `ratings` (new rows) | 2,000 | 2,000 / day |

## Consequences

- An import of more than 100,000 watches stops at the burst and can be resumed
  as the bucket refills. Robert accepted this.
- A refused write looks like any failed save on every build; no build has copy
  for "slow down".
- Retuning a number is a migration (the numbers are trigger arguments), unlike
  the edge function's budgets, which are a deploy.
- Not covered: `library_items` (bounded by the catalog, which `tmdb-proxy`'s
  `catalog` bucket bounds), edits to a review, and the read side (`get_stats`
  can still be called in a loop).
- Like / unlike in a loop is capped at 200 an hour, not prevented.

## Rejected

- **Limits in the app.** They would not reach installed builds or direct API calls.
- **A unique key on the watch tables.** Rewatches are real rows.
- **A hard cap on total rows per account.** A long history is legitimate; the
  rate is what distinguishes abuse.
