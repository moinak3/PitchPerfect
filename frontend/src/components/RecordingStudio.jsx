import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'

function useWaveform(canvasRef, analyserRef, isActive) {
  const rafRef = useRef(null)

  useEffect(() => {
    if (!isActive || !analyserRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const analyser = analyserRef.current
    const buf = new Uint8Array(analyser.fftSize)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(buf)

      const W = canvas.width
      const H = canvas.height

      ctx.fillStyle = '#0A0A0A'
      ctx.fillRect(0, 0, W, H)

      // Grid lines
      ctx.strokeStyle = '#1A1A1A'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, H / 2)
      ctx.lineTo(W, H / 2)
      ctx.stroke()

      // Waveform
      ctx.lineWidth = 2
      ctx.strokeStyle = '#F59E0B'
      ctx.shadowColor = '#F59E0B'
      ctx.shadowBlur = 6
      ctx.beginPath()

      const step = W / buf.length
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128.0
        const y = (v * H) / 2
        if (i === 0) ctx.moveTo(0, y)
        else ctx.lineTo(i * step, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    draw()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isActive, canvasRef, analyserRef])

  // Draw idle flat line when not recording
  useEffect(() => {
    if (isActive || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = '#0A0A0A'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()
  }, [isActive, canvasRef])
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function hzToMidi(hz) {
  if (!hz || hz <= 0) return null
  return 12 * Math.log2(hz / 440) + 69
}
function midiToNote(midi) {
  const r = Math.round(midi)
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1)
}

// First index i where arr[i] >= target (arr sorted ascending).
function lowerBound(arr, target) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Median reference pitch (Hz) within [a, b]. null if no voiced frames there.
function medianHz(times, hz, a, b) {
  const vals = []
  for (let i = lowerBound(times, a); i < times.length && times[i] <= b; i++) {
    if (hz[i] > 0) vals.push(hz[i])
  }
  if (!vals.length) return null
  vals.sort((x, y) => x - y)
  return vals[vals.length >> 1]
}

// Attach a target note (the reference pitch the singer should hit) to every
// display word, computed from the reference pitch contour over the word's
// time window.  Falls back to a wider window for short/consonant words so each
// word still gets a note.  Runs once per data change (not per animation frame).
function attachWordNotes(words, pitchGuide) {
  const times = pitchGuide?.times
  const hz = pitchGuide?.hz
  if (!times?.length || !hz?.length) return words
  for (const w of words) {
    let m = medianHz(times, hz, w.start - 0.05, w.end + 0.05)
    if (m == null) m = medianHz(times, hz, w.start - 0.25, w.end + 0.3)
    w.hz = m || null
    w.note = m ? midiToNote(hzToMidi(m)) : null
  }
  return words
}

function PitchGuide({ refWords, recTime, pitchGuide }) {
  const W = 640, H = 80, PT = 8, PB = 16, PL = 36, PR = 8
  const cW = W - PL - PR
  const cH = H - PT - PB

  // Cursor sits at 25% from left so we mostly see what's coming
  const CURSOR_FRAC = 0.25
  const windowDur = 9          // total seconds visible
  const windowStart = recTime - windowDur * CURSOR_FRAC
  const windowEnd   = recTime + windowDur * (1 - CURSOR_FRAC)

  const tx = t => PL + ((t - windowStart) / (windowDur)) * cW
  const cursorX = tx(recTime)

  const { pts, midiMin, midiMax, noteAtCursor } = useMemo(() => {
    if (!pitchGuide?.times?.length) return { pts: [], midiMin: 60, midiMax: 72, noteAtCursor: null }

    const { times, hz } = pitchGuide
    const inWindow = []
    for (let i = 0; i < times.length; i++) {
      if (times[i] < windowStart - 0.5 || times[i] > windowEnd + 0.5) continue
      const m = hzToMidi(hz[i])
      if (m) inWindow.push({ t: times[i], m })
    }
    if (!inWindow.length) return { pts: [], midiMin: 60, midiMax: 72, noteAtCursor: null }

    const midiVals = inWindow.map(p => p.m)
    const mMin = Math.floor(Math.min(...midiVals)) - 0.5
    const mMax = Math.ceil(Math.max(...midiVals)) + 0.5
    const ty = m => PT + cH - ((m - mMin) / (mMax - mMin)) * cH

    // Build polyline segments (break on time gaps > 0.4s)
    const segs = []
    let cur = []
    for (let i = 0; i < inWindow.length; i++) {
      if (cur.length && inWindow[i].t - inWindow[i - 1].t > 0.4) { segs.push(cur); cur = [] }
      cur.push({ x: tx(inWindow[i].t), y: ty(inWindow[i].m), t: inWindow[i].t, m: inWindow[i].m })
    }
    if (cur.length) segs.push(cur)

    // Note at cursor position
    let closest = null, bestDist = Infinity
    for (const p of inWindow) {
      const d = Math.abs(p.t - recTime)
      if (d < bestDist) { bestDist = d; closest = p }
    }
    const noteAtCursor = closest && bestDist < 0.5 ? midiToNote(closest.m) : null

    return { pts: segs, midiMin: mMin, midiMax: mMax, ty, noteAtCursor }
  }, [pitchGuide, windowStart, windowEnd, recTime])

  const ty = m => PT + cH - ((m - midiMin) / (midiMax - midiMin)) * cH

  // Visible words in window — used for boundary tick lines only (labels moved to KaraokeDisplay)
  const visibleWords = useMemo(() => {
    if (!refWords?.length) return []
    return refWords.filter(w => w.end >= windowStart && w.start <= windowEnd)
  }, [refWords, windowStart, windowEnd])

  if (!pitchGuide?.times?.length) return null

  // C-note Y labels in range
  const cNotes = []
  for (let m = Math.ceil(midiMin); m <= midiMax; m++) {
    if (m % 12 === 0) cNotes.push(m)
  }

  return (
    <div className="border-t border-[#1C1C1C]">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5">
        <span className="text-[9px] text-gray-700 tracking-widest">PITCH GUIDE</span>
        {noteAtCursor && (
          <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
            ♪ {noteAtCursor} now
          </span>
        )}
      </div>
      <svg width={W} height={H} className="block w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Background */}
        <rect x={PL} y={PT} width={cW} height={cH} fill="#050505" />

        {/* Word bands */}
        {visibleWords.map((w, i) => {
          const x1 = Math.max(PL, tx(w.start))
          const x2 = Math.min(PL + cW, tx(w.end))
          const isCurrent = recTime >= w.start && recTime < w.end
          const isPast = recTime > w.end
          return (
            <rect key={i} x={x1} y={PT} width={Math.max(0, x2 - x1)} height={cH}
              fill={isCurrent ? 'rgba(245,158,11,0.08)' : isPast ? 'rgba(255,255,255,0.015)' : 'rgba(16,185,129,0.03)'}
            />
          )
        })}

        {/* Word boundary tick lines */}
        {visibleWords.map((w, i) => (
          <line key={i} x1={tx(w.start)} y1={PT + cH - 5} x2={tx(w.start)} y2={PT + cH}
            stroke="#2A2A2A" strokeWidth="1"
          />
        ))}

        {/* C-note horizontal guides */}
        {cNotes.map(m => (
          <g key={m}>
            <line x1={PL} y1={ty(m)} x2={PL + cW} y2={ty(m)} stroke="#1A1A1A" strokeWidth="1" />
            <text x={PL - 3} y={ty(m) + 3} textAnchor="end" fontSize="8" fill="#444" fontFamily="monospace">
              {midiToNote(m)}
            </text>
          </g>
        ))}

        {/* Pitch curve — past segments dimmer */}
        {pts.map((seg, si) => {
          const segMidT = (seg[0].t + seg[seg.length - 1].t) / 2
          const isPast = segMidT < recTime - 0.2
          const points = seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
          return (
            <polyline key={si} points={points} fill="none"
              stroke="#10B981"
              strokeWidth={isPast ? "1.5" : "2.5"}
              strokeOpacity={isPast ? 0.25 : 0.9}
              strokeLinejoin="round" strokeLinecap="round"
            />
          )
        })}

        {/* "Now" cursor */}
        <line x1={cursorX} y1={PT} x2={cursorX} y2={PT + cH}
          stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.7"
        />
        {/* Cursor triangle at top */}
        <polygon
          points={`${cursorX - 4},${PT} ${cursorX + 4},${PT} ${cursorX},${PT + 7}`}
          fill="#F59E0B" fillOpacity="0.7"
        />

        {/* Axis */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + cH} stroke="#222" strokeWidth="1" />
        <line x1={PL} y1={PT + cH} x2={PL + cW} y2={PT + cH} stroke="#222" strokeWidth="1" />
      </svg>
    </div>
  )
}

function LyricsReviewPanel({ refWords, sourceLyrics, songTitle, artist, jobId, onRetranscribed }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedOk, setSavedOk] = useState(false)

  if (!refWords?.length) return null

  const detectedText = refWords.map((w) => w.word).join(' ')
  const hasSource = !!sourceLyrics

  const startEdit = () => {
    setEditText(sourceLyrics || detectedText)
    setSaveError(null)
    setSavedOk(false)
    setEditing(true)
    setOpen(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setSaveError(null)
  }

  const saveAndRetranscribe = async () => {
    if (!editText.trim() || !jobId) return
    setSaving(true)
    setSaveError(null)
    try {
      const form = new FormData()
      form.append('lyrics', editText.trim())
      const res = await fetch(`/api/job/${jobId}/retranscribe`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Server error ${res.status}`)
      }
      const data = await res.json()
      setSavedOk(true)
      setEditing(false)
      onRetranscribed?.(data.words, data.lyrics)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[#0F0F0F] border border-[#1E1E1E] rounded-xl mb-4 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#111] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 tracking-widest font-semibold">LYRICS CHECK</span>
          {savedOk ? (
            <span className="text-[9px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded">
              ✓ retranscribed
            </span>
          ) : hasSource ? (
            <span className="text-[9px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded">
              verified from web
            </span>
          ) : (
            <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-600 px-2 py-0.5 rounded">
              whisper only — add artist+title for better accuracy
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <span
              onClick={(e) => { e.stopPropagation(); startEdit() }}
              className="text-[10px] text-amber-500/70 hover:text-amber-400 transition-colors cursor-pointer px-1"
            >
              Edit
            </span>
          )}
          <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-[#1A1A1A] pt-3 space-y-3">
          {editing ? (
            <div className="space-y-2">
              <div className="text-[9px] text-amber-500/70 tracking-widest font-semibold">
                EDIT LYRICS — corrections will retranscribe the reference
              </div>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={10}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] focus:border-amber-500/60 rounded-lg p-3 text-xs text-gray-300 leading-relaxed resize-y outline-none transition-colors font-mono"
              />
              {saveError && (
                <p className="text-red-400 text-xs">{saveError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="px-4 py-2 text-xs border border-[#2A2A2A] hover:border-[#444] text-gray-500 hover:text-gray-300 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAndRetranscribe}
                  disabled={saving || !editText.trim()}
                  className="flex-1 px-4 py-2 text-xs bg-amber-500 hover:bg-amber-400 disabled:bg-[#1A1A1A] disabled:text-gray-600 text-black font-bold rounded-lg transition-colors"
                >
                  {saving ? 'Retranscribing…' : 'Save & Retranscribe'}
                </button>
              </div>
              <p className="text-[10px] text-gray-700">
                Whisper will re-run on the reference vocals using your lyrics as a guide. Takes 30–60 s.
              </p>
            </div>
          ) : (
            <>
              {hasSource && (
                <div>
                  <div className="text-[9px] text-emerald-500/70 tracking-widest mb-1.5 font-semibold">
                    SOURCE LYRICS{songTitle ? ` — ${artist ? artist + ' · ' : ''}${songTitle}` : ''}
                  </div>
                  <div className="max-h-40 overflow-y-auto text-xs text-gray-400 leading-relaxed whitespace-pre-wrap bg-[#0A0A0A] rounded-lg p-3 border border-[#1A1A1A]">
                    {sourceLyrics}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[9px] text-gray-600 tracking-widest mb-1.5 font-semibold">
                  DETECTED BY WHISPER
                </div>
                <div className="max-h-32 overflow-y-auto text-xs text-gray-500 leading-relaxed bg-[#0A0A0A] rounded-lg p-3 border border-[#1A1A1A]">
                  {detectedText}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Tokenise: split on whitespace, strip punctuation, drop empty tokens
function tokeniseLyrics(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?;:()\[\]"'—\-]/g, '').trim())
    .filter(Boolean)
}

const normWord = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '')

/**
 * Align two word sequences via longest-common-subsequence and return the
 * matched index pairs [{ si, ri }] (si = sourceLyrics index, ri = refWords index).
 * Robust to Whisper insertions/deletions (e.g. a whole skipped verse shows up
 * as source words with no ref match).
 */
function lcsPairs(a, b) {
  const n = a.length
  const m = b.length
  if (!n || !m) return []

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push({ si: i, ri: j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Build a display word list (each { word, start, end }) for the karaoke view.
 *
 * GUIDING PRINCIPLES:
 *  1. Show EVERY corrected-lyric word — we iterate over the source tokens, so
 *     nothing goes missing even when Whisper skipped or mangled a line.
 *  2. Timing comes from Whisper's MEASURED word timestamps — never a pitch
 *     heuristic.  Each source token is mapped (by alignment + position) onto a
 *     Whisper word and inherits its real start time.  Only where Whisper has no
 *     words at all do we interpolate/extrapolate.
 *
 * Mapping: LCS gives exact text-match anchors; tokens between/around anchors are
 * mapped positionally onto the corresponding Whisper-word span, so even badly
 * mis-transcribed words (e.g. Whisper "What is" for "Wise men") still land on
 * the correct timestamps.
 */
function buildDisplayWords(refWords, sourceLyrics, pitchGuide, vocalStartTime = 0) {
  const hasRef = refWords?.length > 0
  const tokens = sourceLyrics ? tokeniseLyrics(sourceLyrics) : []

  // ── No corrected lyrics: fall back to Whisper's own words (+ timestamps) ──
  if (!tokens.length) {
    return attachWordNotes(
      hasRef ? refWords.map((w) => ({ word: w.word, start: w.start, end: w.end })) : [],
      pitchGuide
    )
  }

  const S = tokens.length

  // ── No Whisper words at all: spread tokens over voiced pitch frames ──────
  if (!hasRef) {
    const times = pitchGuide?.times
    if (!times?.length) return []
    const voiced = times.filter((t) => t >= vocalStartTime)
    const base = voiced.length ? voiced : times
    const N = base.length
    return attachWordNotes(
      tokens.map((word, i) => {
        const fi = Math.min(Math.floor((i * N) / S), N - 1)
        const nfi = Math.min(Math.floor(((i + 1) * N) / S), N - 1)
        return { word, start: base[fi], end: nfi !== fi ? base[nfi] : base[fi] + 0.4 }
      }),
      pitchGuide
    )
  }

  const R = refWords.length

  // ── Map each SOURCE token → a Whisper word index (→ real timestamp) ──────
  const srcNorm = tokens.map(normWord)
  const refNorm = refWords.map((w) => normWord(w.word))
  const pairs = lcsPairs(srcNorm, refNorm) // [{ si, ri }] exact text matches

  const refIdxForSrc = new Array(S).fill(null)
  for (const { si, ri } of pairs) refIdxForSrc[si] = ri

  // Positionally map source tokens [s0,s1) onto Whisper words [r0,r1).
  // Leaves null where Whisper has no words for that span (rn === 0).
  const fillRange = (s0, s1, r0, r1) => {
    const sn = s1 - s0
    const rn = r1 - r0
    for (let k = 0; k < sn; k++) {
      if (rn > 0) refIdxForSrc[s0 + k] = r0 + Math.min(rn - 1, Math.floor((k * rn) / sn))
    }
  }

  if (!pairs.length) {
    fillRange(0, S, 0, R)
  } else {
    fillRange(0, pairs[0].si, 0, pairs[0].ri) // leading
    for (let p = 0; p < pairs.length - 1; p++) {
      fillRange(pairs[p].si + 1, pairs[p + 1].si, pairs[p].ri + 1, pairs[p + 1].ri)
    }
    const last = pairs[pairs.length - 1]
    fillRange(last.si + 1, S, last.ri + 1, R) // trailing
  }

  // Resolve each token's start time from its mapped Whisper word.
  const starts = new Array(S).fill(null)
  for (let i = 0; i < S; i++) {
    const ri = refIdxForSrc[i]
    if (ri != null) starts[i] = refWords[ri].start
  }

  // Locate first/last anchored tokens to bound the gap-filling.
  let firstKnown = -1
  let lastKnown = -1
  for (let i = 0; i < S; i++) {
    if (starts[i] != null) {
      if (firstKnown < 0) firstKnown = i
      lastKnown = i
    }
  }

  if (firstKnown < 0) {
    // No mapping at all — spread proportionally over Whisper timeline.
    for (let i = 0; i < S; i++) {
      starts[i] = refWords[Math.min(Math.floor((i * R) / S), R - 1)].start
    }
  } else {
    const span = lastKnown - firstKnown
    const avgDur =
      span > 0 ? Math.max(0.12, (starts[lastKnown] - starts[firstKnown]) / span) : 0.45
    // Leading tokens Whisper never produced (it skipped the opening verse):
    // anchor the first token to the true vocal onset (from pitch) and spread
    // linearly up to the first Whisper-anchored word.  This is far more accurate
    // than stepping backward at the average pace, which would land the opening
    // words several seconds late.
    const leadStart = Math.min(vocalStartTime || 0, starts[firstKnown])
    if (firstKnown > 0) {
      if (leadStart < starts[firstKnown]) {
        for (let i = 0; i < firstKnown; i++) {
          starts[i] = leadStart + ((starts[firstKnown] - leadStart) * i) / firstKnown
        }
      } else {
        for (let i = firstKnown - 1; i >= 0; i--) starts[i] = Math.max(0, starts[i + 1] - avgDur)
      }
    }
    // Trailing tokens: step forward.
    for (let i = lastKnown + 1; i < S; i++) starts[i] = starts[i - 1] + avgDur
    // Interior gaps (Whisper merged words): linear interpolate between anchors.
    let i = firstKnown + 1
    while (i < lastKnown) {
      if (starts[i] == null) {
        let j = i
        while (j < S && starts[j] == null) j++
        const t0 = starts[i - 1]
        const t1 = starts[j]
        const n = j - (i - 1)
        for (let k = i; k < j; k++) starts[k] = t0 + ((t1 - t0) * (k - (i - 1))) / n
        i = j
      } else {
        i++
      }
    }
  }

  // Enforce non-decreasing starts (alignment noise can invert a few).
  for (let i = 1; i < S; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1]

  return attachWordNotes(
    tokens.map((word, i) => ({
      word,
      start: starts[i],
      end: i + 1 < S ? Math.max(starts[i] + 0.12, starts[i + 1]) : starts[i] + 0.45,
    })),
    pitchGuide
  )
}

// Karaoke-style lyrics display: shows ~9 words centered on the current word,
// with past/current/upcoming words styled differently.
// Uses sourceLyrics text (if available) timed via pitchGuide voiced frames.
function KaraokeDisplay({ refWords, sourceLyrics, pitchGuide, recTime, vocalStartTime }) {
  const displayWords = useMemo(
    () => buildDisplayWords(refWords, sourceLyrics, pitchGuide, vocalStartTime),
    [refWords, sourceLyrics, pitchGuide, vocalStartTime]
  )

  if (!displayWords.length) return null

  // Find the current word index
  const currentIdx = displayWords.findIndex(
    (w) => recTime >= w.start && recTime < w.end
  )
  // If between words, find the next upcoming word and anchor just before it
  const upcomingIdx =
    currentIdx === -1 ? displayWords.findIndex((w) => w.start > recTime) : -1

  const focusIdx =
    currentIdx !== -1
      ? currentIdx
      : upcomingIdx > 0
      ? upcomingIdx - 1
      : upcomingIdx === 0
      ? 0
      : displayWords.length - 1

  // Show a window of words around focus
  const BEFORE = 3
  const AFTER = 5
  const sliceStart = Math.max(0, focusIdx - BEFORE)
  const sliceEnd = Math.min(displayWords.length, focusIdx + AFTER + 1)
  const slice = displayWords.slice(sliceStart, sliceEnd)

  // Vertical offset for each word's note — maps its pitch within the visible
  // window so you can *see* the melody rise and fall across the words.
  const midis = slice.map((w) => (w.hz ? hzToMidi(w.hz) : null)).filter((m) => m != null)
  const mLo = midis.length ? Math.min(...midis) : 0
  const mHi = midis.length ? Math.max(...midis) : 1
  const noteLift = (hz) => {
    if (!hz || mHi === mLo) return 0
    // Higher pitch → lifted further up (max ~18px)
    return Math.round(((hzToMidi(hz) - mLo) / (mHi - mLo)) * 18)
  }

  return (
    <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-2 px-4 py-3 min-h-[68px]">
      {slice.map((w, i) => {
        const absIdx = sliceStart + i
        const isCurrent = absIdx === currentIdx
        const isPast = recTime > w.end
        return (
          <div key={absIdx} className="flex flex-col items-center justify-end">
            {/* Target note for this word */}
            <span
              className={`text-[10px] font-mono leading-none mb-1 transition-all duration-150 select-none ${
                isCurrent
                  ? 'text-emerald-300'
                  : isPast
                  ? 'text-gray-700'
                  : 'text-emerald-700/80'
              }`}
              style={{ transform: `translateY(${-noteLift(w.hz)}px)` }}
            >
              {w.note || '·'}
            </span>
            <span
              className={`text-lg font-bold leading-none transition-all duration-150 select-none ${
                isCurrent
                  ? 'text-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                  : isPast
                  ? 'text-gray-700'
                  : 'text-gray-500'
              }`}
            >
              {w.word}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function RecordingStudio({
  jobId,
  isRecording,
  onRecordingStart,
  onRecordingStop,
  onComplete,
  error,
  vocalStartTime = 0,
  songDuration = 0,
  refWords = [],
  sourceLyrics = null,
  songTitle = '',
  artist = '',
  onRetranscribed,
  pitchGuide = null,
}) {
  const [withVocals, setWithVocals] = useState(false)
  const [countdown, setCountdown] = useState(null)
  // recTime is a float driven by audioRef.currentTime for smooth sync
  const [recTime, setRecTime] = useState(0)
  const [hasRecording, setHasRecording] = useState(false)
  const [micError, setMicError] = useState(null)
  const [mode, setMode] = useState('live') // 'live' | 'upload'
  const fileInputRef = useRef(null)

  const canvasRef = useRef(null)
  const analyserRef = useRef(null)
  const mediaRecRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)        // replaces setInterval timer
  const blobRef = useRef(null)
  const audioRef = useRef(null)

  useWaveform(canvasRef, analyserRef, isRecording)

  const trackUrl = `/api/audio/${jobId}/${withVocals ? 'original' : 'backing'}`

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cleanup = useCallback(() => {
    if (mediaRecRef.current?.state === 'recording') {
      mediaRecRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    stopRaf()
    analyserRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [stopRaf])

  useEffect(() => () => cleanup(), [cleanup])

  const startRecording = useCallback(async () => {
    setMicError(null)

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (e) {
      setMicError('Microphone access denied. Please allow mic access and try again.')
      return
    }

    streamRef.current = stream

    // Analyser for waveform
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    analyserRef.current = analyser

    // MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      blobRef.current = blob
      setHasRecording(true)
    }

    // 3-second countdown then start
    let count = 3
    setCountdown(count)
    const tick = setInterval(() => {
      count -= 1
      if (count <= 0) {
        clearInterval(tick)
        setCountdown(null)

        recorder.start(100)
        onRecordingStart?.()

        if (audioRef.current) {
          audioRef.current.currentTime = 0
          audioRef.current.play().catch(() => {})
        }

        // RAF loop: read audio.currentTime every frame for smooth, locked sync
        const frame = () => {
          if (audioRef.current) {
            setRecTime(audioRef.current.currentTime)
          }
          rafRef.current = requestAnimationFrame(frame)
        }
        rafRef.current = requestAnimationFrame(frame)
      } else {
        setCountdown(count)
      }
    }, 1000)
  }, [onRecordingStart])

  const stopRecording = useCallback(() => {
    cleanup()
    onRecordingStop?.()
  }, [cleanup, onRecordingStop])

  const handleSubmit = useCallback(() => {
    if (blobRef.current) onComplete(blobRef.current)
  }, [onComplete])

  const handleRecordAgain = useCallback(() => {
    setHasRecording(false)
    setRecTime(0)
    blobRef.current = null
  }, [])

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    blobRef.current = file
    setHasRecording(true)
    setRecTime(0)
  }, [])

  const recSeconds = Math.floor(recTime)
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-amber-400 mb-1">Recording Studio</h2>
        <p className="text-gray-500 text-sm">
          Press REC, then sing along to the song playing through your speakers.
        </p>
        {vocalStartTime > 5 && (
          <p className="mt-2 text-xs text-amber-600">
            Vocals start at {fmt(vocalStartTime)} — sing through to the end for the best score
            {songDuration > 0 && ` (song is ${fmt(songDuration)})`}.
          </p>
        )}
      </div>

      {/* Lyrics review */}
      {!isRecording && (
        <LyricsReviewPanel
          refWords={refWords}
          sourceLyrics={sourceLyrics}
          songTitle={songTitle}
          artist={artist}
          jobId={jobId}
          onRetranscribed={onRetranscribed}
        />
      )}

      {/* Live / Upload mode toggle */}
      <div className="flex gap-1 bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl p-1 mb-4">
        {[
          { id: 'live', label: '● Record Live' },
          { id: 'upload', label: '↑ Upload File' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setHasRecording(false); setRecTime(0); blobRef.current = null }}
            disabled={isRecording}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
              mode === id
                ? 'bg-[#1E1E1E] text-gray-200'
                : 'text-gray-600 hover:text-gray-400 disabled:cursor-not-allowed'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Track toggle */}
      <div className="bg-[#0F0F0F] border border-[#1E1E1E] rounded-xl p-4 mb-4 flex items-center justify-between">
        <span className="text-[10px] text-gray-600 tracking-widest">PLAYBACK TRACK</span>
        <div className="flex items-center gap-1 bg-[#0A0A0A] rounded-lg p-1 border border-[#1C1C1C]">
          {[
            { value: false, label: 'Backing Only' },
            { value: true, label: 'With Vocals' },
          ].map(({ value, label }) => (
            <button
              key={String(value)}
              onClick={() => setWithVocals(value)}
              disabled={isRecording}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
                withVocals === value
                  ? 'bg-amber-500 text-black'
                  : 'text-gray-500 hover:text-gray-300 disabled:cursor-not-allowed'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Karaoke + pitch guide — only shown while recording */}
      {isRecording && (
        <div className="bg-[#080808] border border-[#1C1C1C] rounded-xl overflow-hidden mb-4">
          {/* Karaoke lyrics line */}
          <KaraokeDisplay refWords={refWords} sourceLyrics={sourceLyrics} pitchGuide={pitchGuide} recTime={recTime} vocalStartTime={vocalStartTime} />
          {/* Pitch curve */}
          <PitchGuide refWords={refWords} recTime={recTime} pitchGuide={pitchGuide} />
        </div>
      )}

      {/* Waveform */}
      <div className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl overflow-hidden mb-6">
        <canvas ref={canvasRef} width={700} height={90} className="w-full" />
        {isRecording && (
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-2">
              <div className="relative flex">
                <div className="w-2 h-2 bg-red-500 rounded-full" />
                <div className="absolute inset-0 w-2 h-2 bg-red-500 rounded-full animate-ping opacity-75" />
              </div>
              <span className="text-red-400 text-xs font-semibold tracking-wider">
                REC {fmt(recSeconds)}
              </span>
            </div>
            {recSeconds < 60 && (
              <span className="text-gray-600 text-[10px]">
                Aim for 60s+ through vocal sections
              </span>
            )}
            {recSeconds >= 60 && (
              <span className="text-emerald-700 text-[10px]">✓ good length</span>
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {(micError || error) && (
        <div className="mb-4 p-3 bg-red-950/50 border border-red-800/50 rounded-lg text-red-300 text-xs">
          {micError || error}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col items-center gap-5">
        {mode === 'upload' ? (
          hasRecording ? (
            <div className="text-center space-y-4 w-full">
              <p className="text-emerald-400 text-sm">✓ File loaded — ready to analyze</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setHasRecording(false); blobRef.current = null; if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="px-6 py-3 border border-[#2A2A2A] hover:border-[#444] text-gray-400 hover:text-gray-200 rounded-xl text-sm transition-colors"
                >
                  Change File
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-sm transition-colors"
                >
                  Analyze My Performance →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg,.flac"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 w-full max-w-xs border-2 border-dashed border-[#2A2A2A] hover:border-amber-500/40 rounded-2xl py-8 text-gray-500 hover:text-gray-300 transition-all"
              >
                <span className="text-3xl">↑</span>
                <span className="text-sm font-semibold">Choose audio file</span>
                <span className="text-xs text-gray-700">WAV, MP3, M4A, WebM, OGG…</span>
              </button>
            </div>
          )
        ) : (
          <>
            {countdown !== null && (
              <div className="text-7xl font-bold text-amber-400 tabular-nums animate-score-pop">
                {countdown}
              </div>
            )}

            {isRecording ? (
              <button
                onClick={stopRecording}
                className="flex items-center gap-3 bg-[#1A0000] hover:bg-red-950 border border-red-800 text-red-400 px-8 py-4 rounded-2xl font-bold text-sm transition-all"
              >
                <span className="w-3 h-3 bg-red-500 rounded-sm" />
                Stop Recording
              </button>
            ) : hasRecording ? (
              <div className="text-center space-y-4 w-full">
                <p className="text-emerald-400 text-sm">
                  ✓ Recording captured ({fmt(recSeconds)})
                </p>
                {recSeconds < 45 && (
                  <p className="text-amber-600 text-xs text-center max-w-xs">
                    Short recording ({fmt(recSeconds)}) — fewer words will be scored.
                    Try recording 60s+ through an active vocal section.
                  </p>
                )}
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleRecordAgain}
                    className="px-6 py-3 border border-[#2A2A2A] hover:border-[#444] text-gray-400 hover:text-gray-200 rounded-xl text-sm transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleSubmit}
                    className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-sm transition-colors"
                  >
                    Analyze My Performance →
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={startRecording}
                disabled={countdown !== null}
                className="group relative w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-600/30 hover:shadow-red-500/40 hover:scale-105"
              >
                <span className="text-white font-bold text-sm tracking-wider">REC</span>
              </button>
            )}

            {!isRecording && !hasRecording && (
              <p className="text-gray-700 text-xs text-center max-w-xs">
                A 3-second countdown plays before recording starts. The song will play through your speakers while your mic captures your voice.
              </p>
            )}
          </>
        )}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={trackUrl} preload="auto" />
    </div>
  )
}
