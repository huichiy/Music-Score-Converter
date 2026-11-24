# 01: Fix the five bugs the whole-branch review found

**What to build:** imported scores, text-edited scores and playback behave correctly in the five cases below. Work on branch `audit2-final`; do not touch `fix/audit-2` or `main`, do not push.

1. **Partly tied chords (MusicXML).** When a chord continues only some of the previous notes, the new notes are seen and heard. Today E tied to E with a new C below turns the whole chord into `-` and the C disappears; E tied to E under a new top G draws a slur that isn't there. Both were reproduced. Decision: guessing a tie (same pitch, stop omitted) or a slur (different pitch) only applies when no member of the chord writes its own tie stop. A chord where only some members write one is a new attack.
2. **Markings before a barline or a rest block (Route B).** A marking with no notes after it yet waits for its bar's notes. Today `|:` at a line end followed by `|` loses the repeat, `{1} |` loses the ending, and `&f [4]` at the start of the text moves the dynamic past the rests (all reproduced); read from the code, `< [4]` there loses its hairpin the same way.
3. **Editing an X.** An X (unpitched hit) keeps only its length. Today the note popup lets octave and accidental stick (reproduced).
4. **Leaving while the audio downloads.** Pressing play and going to the landing page or the text editor before the audio has loaded stays silent. Read from the code, not reproduced: reproduce it in the browser before fixing, and report it as not a bug if it does not happen.
5. **Impossible lengths.** A malformed length such as ABC `C/0` must not hang the page. Read from the code, not run: run the red test with a time limit so the hang cannot block the session.

**Test seams, agreed with the user:** MusicXML part parsing for 1, parse text plus serialize text for 2, the edited-note function for 3, ABC parsing for 5. 4 has no unit seam.

**Review scope:** only the changes after `459879c`. The rest of the branch has been reviewed. This ticket is the spec.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] E tied to E with a new C below: a new attack, with the C shown
- [ ] E tied to E under a new top G: no slur
- [ ] A fully tied chord, an omitted tie stop at the same pitch, and a pitch-changing tie becoming a slur (GitHub issue #1) read as before
- [ ] `|:` at a line end with `|` at the next line start keeps the repeat
- [ ] `{1} |` puts the ending on the bar that follows
- [ ] `&f [4]` and `< [4]` at the start of the text put the marking on the rests
- [ ] `1 2 3 4 | :|` still repeats the bar before it
- [ ] Octave and accidental picked on an X do not stick; picking 1–7 makes it an ordinary note
- [ ] Leaving during the download stays silent, pressing play again afterwards sounds, and ordinary play / pause / resume is unchanged
- [ ] An ABC tune containing `C/0` loads and its later bars are right
- [ ] `npm run test` and `npm run build` pass
- [ ] The untracked probe script in the scripts folder (`zz-probe.ts`) is moved out of the repo, not committed
