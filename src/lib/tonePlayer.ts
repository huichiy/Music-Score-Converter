// Audio layer for playback — the only file that knows Tone.js exists.
//
// Lazy-loaded exactly like pdfjs in pdfTools.ts: the import only happens when
// the user actually presses play, so the main bundle is unaffected.
//
// Everything here speaks BEATS, not seconds. Events are scheduled in Transport
// ticks, so the speed slider (Transport.bpm) and seeking are handled natively by
// Tone and never require rebuilding the event list.
//
// Tone 15.x exposes both the deprecated `Tone.Transport` singleton and the
// current `Tone.getTransport()` accessor (checked via node_modules/tone/build/esm/index.d.ts) — we use getTransport() as recommended.

import type { PlaybackEvent } from './playback'
import { totalBeatsOf } from './playback'

export interface Player {
  load(events: PlaybackEvent[], bpm: number): Promise<void>
  play(): void
  pause(): void
  /** Stop and rewind. `letRing` keeps the sounding notes' own release tail
   *  instead of cutting them — used when the piece ends by itself. */
  stop(letRing?: boolean): void
  seekBeat(beat: number): void
  setRate(rate: number): void
  /** Where the LISTENER is in the piece, in beats (not where the scheduler is). */
  positionBeats(): number
  readonly totalBeats: number
  dispose(): void
}

type ToneModule = typeof import('tone')

let tonePromise: Promise<ToneModule> | null = null

async function ensureTone(): Promise<ToneModule> {
  if (!tonePromise) tonePromise = import('tone')
  return await tonePromise
}

/**
 * Build a player. Must be called from a user gesture (the play button) so the
 * browser lets us start audio.
 */
export async function createPlayer(): Promise<Player> {
  const Tone = await ensureTone()
  await Tone.start()

  const transport = Tone.getTransport()
  // PolySynth so chords (double stops) sound together; FMSynth is the
  // wind-instrument-ish preset chosen during the A/B demo.
  const synth = new Tone.PolySynth(Tone.FMSynth).toDestination()
  synth.volume.value = -8

  let total = 0
  let baseBpm = 90
  let rate = 1
  // Tone applies a seek one lookAhead (~100 ms) in the future, so the audible
  // clock keeps reporting the OLD position until then — which would snap the
  // slider back. Report the target until the jump has actually happened.
  let seekHold: { beat: number; until: number } | null = null

  return {
    async load(events, bpm) {
      transport.stop()
      transport.cancel()
      transport.ticks = 0
      // Same lag as a seek: until the rewind is audible the old position shows
      seekHold = { beat: 0, until: Tone.now() + 0.05 }
      baseBpm = bpm
      transport.bpm.value = bpm * rate
      total = totalBeatsOf(events)

      const ppq = transport.PPQ
      for (const ev of events) {
        // Times MUST stay in ticks ("<n>i" is Tone's tick notation). Converting
        // to seconds here would freeze the schedule at the current BPM, so the
        // speed slider would only affect notes scheduled afterwards.
        const startTicks = `${Math.round(ev.startBeat * ppq)}i`
        const durTicks = `${Math.max(1, Math.round(ev.durBeats * ppq))}i`
        transport.schedule((time) => {
          synth.triggerAttackRelease(
            Tone.Frequency(ev.midi, 'midi').toFrequency(),
            durTicks,
            time,
          )
        }, startTicks)
      }
    },
    play() { transport.start() },
    pause() { transport.pause() },
    stop(letRing = false) {
      transport.stop()
      transport.ticks = 0
      seekHold = null
      // Every note already carries its own scheduled release, so at the natural
      // end releaseAll() would only cut the last one short.
      if (!letRing) synth.releaseAll()
    },
    seekBeat(beat) {
      const ticks = Math.max(0, Math.round(beat * transport.PPQ))
      transport.ticks = ticks
      // +50 ms covers the tick-boundary delay Tone adds while the transport runs
      seekHold = { beat: ticks / transport.PPQ, until: Tone.now() + 0.05 }
    },
    setRate(next) {
      rate = next
      transport.bpm.value = baseBpm * next
    },
    positionBeats() {
      // transport.ticks reads at Tone.now() = currentTime + lookAhead, so it
      // runs ~100 ms ahead of what the speakers play: the highlight led the
      // audio and the end-of-piece check fired before the last note ended.
      // Ask the clock about the audible instant instead.
      const t = Tone.immediate()
      if (seekHold) {
        if (t < seekHold.until) return seekHold.beat
        seekHold = null
      }
      return transport.getTicksAtTime(t) / transport.PPQ
    },
    get totalBeats() { return total },
    dispose() {
      transport.stop()
      transport.cancel()
      synth.dispose()
    },
  }
}
