# 02: Bring the fixes into fix/audit-2 and accept them in the browser

**What to build:** `fix/audit-2` contains the fixes from 01, and the user has clicked through the app and accepted it. An agent may do the fast-forward and run the tests once the user says so; the browser part is the user's. They declined one run of the Playwright scripts, so do not run those without asking.

**Blocked by:** 01

**Status:** ready-for-human

- [ ] `fix/audit-2` is fast-forwarded to `audit2-final`; `main` is untouched and nothing is pushed
- [ ] `npm run test` and `npm run build` pass on `fix/audit-2`
- [ ] Dialogs: pressing inside, dragging out and releasing does not close them
- [ ] OCR: crop a row, then crop a second row from the same whole picture
- [ ] Playback: a failed audio download can be retried; a percussion score shows X and does not crash
- [ ] Note popup: edit a note, a rest and an X
- [ ] PDF: the page picker opens, and a crop of a page reaches OCR
- [ ] A wrong or broken file leaves the score on screen and says why
