# 03: Bring CLAUDE.md and the project memory up to date

**What to build:** a session that starts cold reads a correct description of the project. `CLAUDE.md` has not been updated for this audit round. Use the `writing-for-agents` skill. Where the doc and the code differ, the code is right.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Files added this round: directions, meter, text header, slurs, score file, backdrop-close hook, Worker adapter
- [ ] New fields: `tupletLen`, `_pickup`, the unpitched X, the store's `ocrSource`
- [ ] New rules: the highest chord note is the melody; slurs tracked by number; the measure timeline (`<forward>` / `<backup>`); MIDI meter changes; loading in one commit (`commitScore`); current OCR model ids; the 32768 output cap; the legacy pdf.js build; the five fixes from 01
- [ ] Drawing rules: tempo position, grace note room, accidental column, whole-rest symbols by meter
- [ ] Test file list and assertion counts match `npm run test`; the statements this round made wrong (model ids, 8192, the old test counts) are gone
- [ ] The project memory's status file says what is not merged, not pushed and not deployed, and lists the decisions still waiting for the user
