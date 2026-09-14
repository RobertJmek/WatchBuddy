# ADR 0020 — Explicit search submit, and why there is only one term channel

**Status:** accepted · targets v1.18.0 (removes a limitation; PR #70)

## Context

The Search tab queried TMDB only after a 500 ms debounce **and** only once the
trimmed query reached `MIN_CHARS` (3). Anything shorter showed *"Type at least 3
characters to search."* with no way past it, which made a real class of titles
unreachable: *It*, *Up*, *Us*, *M*, *9*. The keyboard already advertised a
**Search** return key (`returnKeyType="search"`) and nothing was wired to it —
`onSubmitEditing` was unused anywhere in the app.

The floor was never a backend constraint. `tmdb-proxy`'s `search` action accepts
any non-empty `q` up to 200 characters and charges a flat 3 units against the
per-user bucket (ADR 0016), regardless of length. The 3 was pure client-side
throttling of the type-ahead: it exists to stop a request per keystroke, not to
protect the upstream from short words.

## Decision

**Keep the live type-ahead exactly as it is, and add an explicit submit
alongside it.** A magnifying-glass button in the input row and the keyboard's
Search key both query any non-empty term. Nothing about the 3+ character path
changes, so the API load of ordinary typing is unchanged.

### Why not simply lower `MIN_CHARS` to 2

This was the code review's recommendation and it was considered and rejected.

- **It doesn't reach the goal.** *It* and *Up* would be found; *M* and *9* would
  not, and one-character search has no other route in the app. A floor of 1 is
  not an option — that is a request on the first keystroke of every search.
- **It puts every user's two-letter prefix on the wire.** Typing *matrix* would
  spend an extra 3 bucket units on `ma`, on the live path, once per search
  session — to serve a case the button already covers on demand.

An explicit submit is also the honest shape for this: a short term is a
deliberate search, not something to guess at mid-word.

### One term channel, not two

The first cut stored the submitted term and reconciled it at each use with
`submitted === trimmed`. That reads as a neat self-invalidating trick and is the
wrong shape: it merely **suspends** a stale submit rather than retiring it, so
every consumer has to repeat the comparison, and each one that forgets fails
differently. The review found four separate bugs that were all this:

- `mode` keyed on the derived term sent every 2→3 character crossing into the
  hint for the whole debounce window — the list unmounted and *"tap search for
  short titles"* appeared under a long query.
- A suspended submit **re-armed** when the text passed through the same value
  again: submit `it`, clear the box, type `italian job`, and a search for `it`
  fired at the second character.
- The dimmed button and the haptic each made their own judgement about whether a
  submit was a no-op, and disagreed with the query layer.

**The fix is to clear `submitted` in `onChangeText`'s own batch.** It is then
non-empty *only while it equals the typed term, by construction*, so the whole
rule is `term = submitted || liveTerm` and the comparison disappears from every
other site. The general form: a second source for a derived value is only safe
if it cannot disagree with the first — invalidate it at the edit, not at each
read.

Two consequences follow and are load-bearing:

- **`mode` stays keyed on the typed length** (`trimmed.length < MIN_CHARS &&
  !submitted`), never on the derived term. A debounce window must not be able to
  bounce a long query back to an empty-state hint.
- **A `settling` flag** (`mode === 'search' && term !== trimmed`) marks "the rows
  on screen don't answer what's in the box yet". It dims the list and holds the
  spinner. Without it the disabled query flashes *"No results"* — a pre-existing
  bug on `main` — and the previous term's rows sit there undimmed, reading as
  current.

### The button is also the retry

Submit calls `search.refetch()` when the term is already the live one. Setting
state alone would not change the query key, so nothing would be sent, and the
button would be inert exactly where it is most wanted: after a failed request.
This is also why it stays pressable while dimmed, and why it declares
`accessibilityState={{ busy }}` rather than `disabled` (ADR 0018).

## Consequences

- Short titles are searchable, and a 3+ character term can be submitted before
  the debounce fires to start its query immediately.
- **The query key is unchanged:** `keys.search(term)` (ADR 0019). A 2-character
  submitted term and a 3-character live term are the same resource and share one
  cache entry.
- **People search (`@…`) is untouched.** It is a Supabase prefix query, already
  live from one character; the button hides in that mode.
- `MIN_CHARS` still means one thing — the live floor — instead of quietly
  becoming the app's definition of a searchable term.
- The derivation is three lines with a single rule, so it stayed inline rather
  than moving to a pure module like `library-filter.ts`. If a third source of a
  term ever appears, that is the point to extract and give it a harness.
