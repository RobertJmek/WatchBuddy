# ADR 0035 — Sign-in code step: six cells over one field

**Status:** accepted · v1.29.0 (PR #139)

## Context

Email sign-in sends a six-digit code. The code step was one centred text field
that still allowed eight characters, under an uppercase letter-spaced caption;
every failure was an alert carrying GoTrue's raw message, and there was no way
to ask for another code short of going back. Robert asked for a better design
and for the usual research first.

Research: web.dev's OTP form guidance (one input, numeric keypad,
`one-time-code` autofill), Baymard (do not split one value across several
fields on mobile: paste, autofill and moving between fields break), and
pattern write-ups (name the destination, inline errors, resend behind a
30–60 s countdown, keep an explicit submit). One source reported segmented
boxes testing better for short codes; the two are reconciled below.

## Decision

- **Six cells, one real field.** The cells only draw what a single `TextInput`
  holds; the field lies over them, invisible (transparent text, hidden caret),
  so a tap anywhere focuses it and typing, paste and the keyboard's code
  suggestion behave as in any field. No `maxLength`: a pasted "123 456" has to
  arrive whole, and is cleaned to digits and cut to six in JS.
- **The sixth digit verifies; the Verify button stays** for a retry and for
  anyone who expects one.
- **Errors go under the field they are about**, as text a screen reader hears
  arrive (`accessibilityRole="alert"`, `accessibilityLiveRegion`), in our own
  words, never GoTrue's.
- **A wrong code clears the cells.** The advice is to let people fix single
  digits, but the hidden field can only be edited from its end, so leaving a
  wrong code means backspacing through it.
- **Resend code**, disabled for 60 s with a countdown: the auth server sends
  one code a minute to an address, and a shorter wait would only produce an
  error.
- **Layout** follows the tutorial cards: title on one line, one line naming
  the address, the control, then the actions as 44pt text buttons. The logo is
  not repeated on this step.
- **Email step:** a visible "Email" label, an "or" rule under the social
  buttons, the tagline as plain text.

Rejected: six separate inputs (the failure modes above), and auto-submit with
no button.

## Consequences

- Client only; the same `signInWithOtp` / `verifyOtp` calls.
- The cells are a drawing: a change to the code length is `CODE_LENGTH`.
- Not seen when this was written: a real code (send, verify, wrong code,
  resend), paste and code autofill on a device, Android, the light theme, the
  software keyboard over the step.
