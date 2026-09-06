---
name: gapless-audio-lockscreen
description: Diagnose and fix gapless audio/video track auto-advance on mobile web that stutters, skips, or stops — especially across a locked screen or Bluetooth car head unit. Use when auto-advance between tracks works in the foreground but breaks (silence, "0.5s then stop", garbled overlap) once the screen locks, or when several prior fix attempts for this have already failed.
---

# Gapless audio hand-off across a locked mobile screen

## When this applies

A web app plays a sequence of audio (or video) tracks and needs to auto-advance
from one to the next with no gap. It mostly works, but:

- auto-advance stops working once the phone screen locks or the tab is
  backgrounded, or
- the hand-off between tracks stutters, plays a garbled fraction of a
  second, or plays a moment of audio and then goes silent, or
- the previous track's ending audibly overlaps/bleeds into the next
  track's beginning.

Root cause: calling `.play()` on the next item from inside the `ended` event
handler is not reliable on mobile once the screen is locked — the OS/browser
can treat that as a fresh autoplay outside a user gesture and block or
stutter it, even though the same code works fine with the screen on.

## The fix: two pieces, both required

Every partial fix for this looks complete and then fails once actually
tested on a locked screen, because the real fix has two independent parts.
Dropping either one reproduces "plays a moment then stutters/stops":

1. **Start the next item for real, muted, on a second `<audio>` element,
   while the current one is still playing** — well before the current one
   ends (several seconds of lead time, not a few hundred ms).
   - It must be the **actual next file**, not a silent placeholder swapped
     for the real file at hand-off. Swapping `src` at the hand-off boundary
     reintroduces the exact same cold-start-while-locked problem one track
     later — so prime the real content on the same element, straight
     through from priming to hand-off, no `src` swap at the boundary.
   - Silence it with `element.muted = true`, **not just `volume = 0`**. On
     some audio output paths (observed over Bluetooth) `volume = 0` alone
     doesn't fully suppress hardware output, producing an audible bleed of
     the next track's opening syllable/frame under the current track's tail.
   - `timeupdate` gets throttled or stops firing once the screen locks, so
     don't rely on it alone to trigger priming. Also arm a `setTimeout`
     while the track is still actively playing — Chrome exempts
     actively-playing media from background-tab timer throttling, so this
     backup timer still fires when `timeupdate` doesn't.

2. **Hand off slightly *before* the literal `ended` event fires**, not at or
   after it — e.g. trigger the swap once `currentTime` is within ~0.3-0.5s
   of `duration`, checked on every `timeupdate` (and by the backup timer
   above). Waiting for the real `ended` event and swapping exactly then hits
   some OS-level hiccup right at that literal boundary. Handing off a
   fraction of a second early, while the primed element is already
   comfortably mid-flow, avoids it — at the cost of trimming a
   barely-perceptible sliver off the end of each track.

Also carry over: when the OS/media-session fires a spurious `pause` on the
new track shortly after a locked-screen transition, resume it by calling
`.play()` **synchronously inside that same pause/mediaSession event
handler** — a `.play()` issued later from a `setTimeout` is exactly what
locked-screen autoplay policy blocks.

## Anti-patterns seen to fail (don't re-try these)

- Priming with a silent placeholder clip and swapping to the real file at
  hand-off. Looks clean, but the swap is a cold start exactly where you
  can't afford one.
- Silencing the primed element with `volume = 0` only. Looks silent on a
  laptop, can still leak on a phone/Bluetooth.
- Shortening the priming lead time to reduce the audible leak window. This
  looks like it fixes the bleed but actually removes the buffering margin
  the next track needed, trading an audible bleed for a stutter-then-stop.
- Waiting for the literal `ended` event before handing off, once the
  bleeding/overlap bug pushes someone to "stop cutting the track early."
  That early cut is load-bearing, not a bug.
- Resuming a spurious OS pause via a `setTimeout`-deferred `.play()`.
  Must happen synchronously in the same event handler turn.

## If several fix attempts have already failed

Don't propose another isolated tweak (e.g. "let's also try `muted` instead
of `volume`") without first diffing the *entire* file across every attempted
version, from the last version the user says actually worked through HEAD.
The two required pieces above are easy to accidentally split across
different commits — one commit fixes/keeps piece 1 while another commit
(often written to fix a *different*, real complaint) unknowingly removes
piece 2, and vice versa. Ask the user what each intermediate version
actually did on their device if that's not in the commit messages — that
ground truth is what makes the diff converge instead of producing yet
another guess.
