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

// Octave-robust median reference pitch (Hz) within [a, b]. null if no voiced
// frames.  pyin frequently emits octave-jumped estimates (½× or 2× the true
// pitch); we take the median, then keep only frames within ~half an octave of
// it and re-median, which discards those octave outliers.
function robustHz(times, hz, a, b) {
  const vals = []
  for (let i = lowerBound(times, a); i < times.length && times[i] <= b; i++) {
    if (hz[i] > 0) vals.push(hz[i])
  }
  if (!vals.length) return null
  vals.sort((x, y) => x - y)
  let med = vals[vals.length >> 1]
  const kept = vals.filter((v) => v >= med * 0.72 && v <= med * 1.4)
  if (kept.length >= 2) {
    kept.sort((x, y) => x - y)
    med = kept[kept.length >> 1]
  }
  return med
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
    let m = robustHz(times, hz, w.start - 0.05, w.end + 0.05)
    if (m == null) m = robustHz(times, hz, w.start - 0.25, w.end + 0.3)
    w.hz = m || null
    w.midi = m ? hzToMidi(m) : null
    w.note = m ? midiToNote(w.midi) : null
  }
  return words
}

function PitchGuide({ displayWords, recTime, pitchGuide, syncOffset = 0 }) {
  const W = 640, H = 230, PT = 12, PB = 18, PL = 32, PR = 8
  const cW = W - PL - PR
  const cH = H - PT - PB

  // Apply the manual sync trim so the cursor and "current note" track what the
  // user hears, not raw audio.currentTime.
  const effT = recTime - syncOffset

  // Cursor sits at 30% from left so we mostly see what's coming
  const CURSOR_FRAC = 0.3
  const windowDur = 8          // total seconds visible
  const windowStart = effT - windowDur * CURSOR_FRAC
  const windowEnd   = effT + windowDur * (1 - CURSOR_FRAC)
  const tx = t => PL + ((t - windowStart) / windowDur) * cW
  const cursorX = tx(effT)

  // STABLE vertical scale: fixed to the whole song's vocal range so a given
  // note always sits at the same height (no per-frame rescaling).  This is what
  // makes the melodic up/down progression actually readable.
  const { midiMin, midiMax } = useMemo(() => {
    const ms = (displayWords || []).map(w => w.midi).filter(m => m != null)
    if (!ms.length) return { midiMin: 55, midiMax: 67 }
    let lo = Math.min(...ms), hi = Math.max(...ms)
    if (hi - lo < 7) { const c = (lo + hi) / 2; lo = c - 3.5; hi = c + 3.5 } // min ~half octave
    return { midiMin: Math.floor(lo) - 1, midiMax: Math.ceil(hi) + 1 }
  }, [displayWords])

  const ty = m => PT + cH - ((m - midiMin) / (midiMax - midiMin)) * cH

  // Live reference pitch curve (faint), octave-clamped to the stable range.
  const curve = useMemo(() => {
    if (!pitchGuide?.times?.length) return []
    const { times, hz } = pitchGuide
    const segs = []
    let cur = []
    for (let i = 0; i < times.length; i++) {
      const t = times[i]
      if (t < windowStart - 0.5) continue
      if (t > windowEnd + 0.5) break
      let m = hzToMidi(hz[i])
      if (m == null) continue
      // fold octave outliers into the visible range
      while (m < midiMin - 0.5) m += 12
      while (m > midiMax + 0.5) m -= 12
      if (cur.length && t - cur[cur.length - 1].t > 0.35) { segs.push(cur); cur = [] }
      cur.push({ x: tx(t), y: ty(m), t })
    }
    if (cur.length) segs.push(cur)
    return segs
  }, [pitchGuide, windowStart, windowEnd, midiMin, midiMax])

  // Per-word note blocks in the visible window.
  const visWords = useMemo(() => {
    if (!displayWords?.length) return []
    return displayWords.filter(w => w.midi != null && w.end >= windowStart && w.start <= windowEnd)
  }, [displayWords, windowStart, windowEnd])

  const currentWord = useMemo(
    () => (displayWords || []).find(w => effT >= w.start && effT < w.end) || null,
    [displayWords, effT]
  )

  if (!displayWords?.length) return null

  // Octave (C) gridlines within range
  const cLines = []
  for (let m = Math.ceil(midiMin); m <= midiMax; m++) if (m % 12 === 0) cLines.push(m)

  return (
    <div className="border-t border-[#1C1C1C]">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5">
        <span className="text-[9px] text-gray-700 tracking-widest">MELODY GUIDE</span>
        {currentWord?.note && (
          <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
            ♪ sing {currentWord.note}
          </span>
        )}
      </div>
      <svg width={W} height={H} className="block w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect x={PL} y={PT} width={cW} height={cH} fill="#050505" />

        {/* Octave gridlines */}
        {cLines.map(m => (
          <g key={m}>
            <line x1={PL} y1={ty(m)} x2={PL + cW} y2={ty(m)} stroke="#1A1A1A" strokeWidth="1" />
            <text x={PL - 3} y={ty(m) + 3} textAnchor="end" fontSize="9" fill="#555" fontFamily="monospace">
              {midiToNote(m)}
            </text>
          </g>
        ))}

        {/* Faint live reference pitch curve (within-word movement) */}
        {curve.map((seg, si) => (
          <polyline key={si} points={seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none" stroke="#10B981" strokeWidth="1" strokeOpacity="0.22"
            strokeLinejoin="round" strokeLinecap="round"
          />
        ))}

        {/* Connector line between consecutive word notes — shows the progression */}
        {visWords.length > 1 && (
          <polyline
            points={visWords.map(w => {
              const xc = (Math.max(PL, tx(w.start)) + Math.min(PL + cW, tx(w.end))) / 2
              return `${xc.toFixed(1)},${ty(w.midi).toFixed(1)}`
            }).join(' ')}
            fill="none" stroke="#3A4A44" strokeWidth="1" strokeDasharray="2 2"
          />
        )}

        {/* Per-word note blocks */}
        {visWords.map((w, i) => {
          const x1 = Math.max(PL, tx(w.start))
          const x2 = Math.min(PL + cW, tx(w.end))
          const bw = Math.max(6, x2 - x1 - 2)
          const y = ty(w.midi)
          const isCurrent = effT >= w.start && effT < w.end
          const isPast = effT > w.end
          const fill = isCurrent ? '#F59E0B' : isPast ? '#2C3A35' : '#10B981'
          const op = isCurrent ? 1 : isPast ? 0.5 : 0.85
          return (
            <g key={i}>
              <rect x={x1} y={y - 4} width={bw} height={8} rx={4} fill={fill} fillOpacity={op} />
              {(isCurrent || bw > 16) && (
                <text x={x1 + bw / 2} y={y - 8} textAnchor="middle" fontSize="11"
                  fill={isCurrent ? '#FCD34D' : '#6B7B75'} fontFamily="monospace"
                  fontWeight={isCurrent ? 'bold' : 'normal'}>
                  {w.note}
                </text>
              )}
            </g>
          )
        })}

        {/* "Now" cursor */}
        <line x1={cursorX} y1={PT} x2={cursorX} y2={PT + cH} stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.7" />
        <polygon points={`${cursorX - 4},${PT} ${cursorX + 4},${PT} ${cursorX},${PT + 7}`} fill="#F59E0B" fillOpacity="0.7" />

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

  // Assign each token a real [start, end] from the Whisper word it maps to.
  // Crucially we use the Whisper word's OWN end — not the next token's start —
  // so the highlight tracks exactly when each word is sung: it holds through a
  // sustained note, and during an instrumental pause it waits (no word lit) and
  // only lights the next word when it is actually sung (a delayed word stays
  // delayed).
  const starts = new Array(S).fill(null)
  const ends = new Array(S).fill(null)

  // Pass 1 — tokens mapped to a Whisper word.  Each word inherits the exact
  // [start, end] of the Whisper word it aligns to (the most reliable indicator
  // of when that word is sung), and consecutive tokens sharing one Whisper word
  // split its interval evenly.  We do NOT pull onsets earlier to absorb skipped
  // Whisper fragments — that turned out to fire highlights ahead of the audio.
  {
    let i = 0
    while (i < S) {
      const ri = refIdxForSrc[i]
      if (ri == null) { i++; continue }
      let j = i
      while (j < S && refIdxForSrc[j] === ri) j++
      const g = j - i
      const s = refWords[ri].start
      const e = Math.max(refWords[ri].end, s + 0.12)
      for (let k = 0; k < g; k++) {
        starts[i + k] = s + ((e - s) * k) / g
        ends[i + k] = s + ((e - s) * (k + 1)) / g
      }
      i = j
    }
  }

  // Locate first/last assigned token to bound the gap filling.
  let firstKnown = -1
  let lastKnown = -1
  for (let i = 0; i < S; i++) {
    if (starts[i] != null) {
      if (firstKnown < 0) firstKnown = i
      lastKnown = i
    }
  }

  if (firstKnown < 0) {
    // Nothing mapped — spread proportionally over the Whisper timeline.
    for (let i = 0; i < S; i++) {
      const ri = Math.min(Math.floor((i * R) / S), R - 1)
      starts[i] = refWords[ri].start
      ends[i] = Math.max(starts[i] + 0.2, refWords[ri].end)
    }
  } else {
    // Pass 2 — leading tokens Whisper never produced (skipped opening verse):
    // spread from the true vocal onset up to the first assigned token.
    if (firstKnown > 0) {
      const t1 = starts[firstKnown]
      const t0 = Math.min(vocalStartTime || 0, t1)
      for (let k = 0; k < firstKnown; k++) {
        starts[k] = t0 + ((t1 - t0) * k) / firstKnown
        ends[k] = t0 + ((t1 - t0) * (k + 1)) / firstKnown
      }
    }
    // Pass 3 — interior null gaps (Whisper merged/skipped a word): tile the gap
    // between the previous end and the next start.
    let i = firstKnown + 1
    while (i < lastKnown) {
      if (starts[i] == null) {
        let j = i
        while (j <= lastKnown && starts[j] == null) j++
        const t0 = ends[i - 1]
        const t1 = starts[j]
        const span = j - i
        for (let x = 0; x < span; x++) {
          starts[i + x] = t0 + ((t1 - t0) * x) / span
          ends[i + x] = t0 + ((t1 - t0) * (x + 1)) / span
        }
        i = j
      } else {
        i++
      }
    }
    // Pass 4 — trailing tokens after the last Whisper word: step forward.
    const span = lastKnown - firstKnown
    const avgDur =
      span > 0 ? Math.max(0.18, (starts[lastKnown] - starts[firstKnown]) / span) : 0.45
    for (let i = lastKnown + 1; i < S; i++) {
      starts[i] = ends[i - 1]
      ends[i] = starts[i] + avgDur
    }
  }

  // Sanity: non-decreasing starts, and a small minimum duration per word.
  for (let i = 1; i < S; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1]
  for (let i = 0; i < S; i++) if (ends[i] == null || ends[i] < starts[i] + 0.1) ends[i] = starts[i] + 0.25

  return attachWordNotes(
    tokens.map((word, i) => ({ word, start: starts[i], end: ends[i] })),
    pitchGuide
  )
}

// Karaoke-style lyrics display: shows ~9 words centered on the current word,
// with past/current/upcoming words styled differently.
// Uses sourceLyrics text (if available) timed via pitchGuide voiced frames.
function KaraokeDisplay({ displayWords, recTime, syncOffset = 0 }) {
  if (!displayWords?.length) return null

  // Apply manual sync trim so highlight tracks what the user actually hears.
  const effT = recTime - syncOffset

  // Find the current word index
  const currentIdx = displayWords.findIndex(
    (w) => effT >= w.start && effT < w.end
  )
  // If between words, find the next upcoming word and anchor just before it
  const upcomingIdx =
    currentIdx === -1 ? displayWords.findIndex((w) => w.start > effT) : -1

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

  return (
    <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-1 px-4 py-3 min-h-[52px]">
      {slice.map((w, i) => {
        const absIdx = sliceStart + i
        const isCurrent = absIdx === currentIdx
        const isPastEff = effT > w.end
        return (
          <div key={absIdx} className="flex flex-col items-center justify-end">
            <span
              className={`text-lg font-bold leading-none transition-all duration-150 select-none ${
                isCurrent
                  ? 'text-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                  : isPastEff
                  ? 'text-gray-700'
                  : 'text-gray-500'
              }`}
            >
              {w.word}
            </span>
            {/* Target note label (the melody position is shown in the guide below) */}
            <span
              className={`text-[9px] font-mono leading-none mt-1 select-none ${
                isCurrent ? 'text-amber-300/90' : isPastEff ? 'text-gray-800' : 'text-emerald-700/70'
              }`}
            >
              {w.note || '·'}
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
  // Manual sync offset (seconds): the singer's perceived "now" is
  // recTime - (syncOffset + autoLatency).  Positive delays the highlight,
  // negative advances it.  autoLatency is auto-detected from AudioContext
  // when recording starts; syncOffset is the user-tunable residual.
  const [syncOffset, setSyncOffset] = useState(0.3)
  const [autoLatency, setAutoLatency] = useState(0)
  const effectiveOffset = syncOffset + autoLatency

  // Aligned karaoke words (with per-word target notes) — computed once per data
  // change and shared by both the karaoke line and the melody guide.
  const displayWords = useMemo(
    () => buildDisplayWords(refWords, sourceLyrics, pitchGuide, vocalStartTime),
    [refWords, sourceLyrics, pitchGuide, vocalStartTime]
  )
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

    // Auto-detect output latency (sound takes this long to reach the speakers
    // after audio.currentTime advances).  Apply it as a base offset so the
    // manual slider only handles residuals device-to-device.  Bluetooth and
    // some HDMI outputs report meaningful values (50-300 ms); built-in speakers
    // often report ~0 (well-cancelled by the OS).
    const detectedLatency = audioCtx.outputLatency || audioCtx.baseLatency || 0
    if (detectedLatency > 0.01 && detectedLatency < 0.6) {
      setAutoLatency(detectedLatency)
    }

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
          <KaraokeDisplay displayWords={displayWords} recTime={recTime} syncOffset={effectiveOffset} />
          {/* Melody guide — per-word target notes on a stable pitch scale */}
          <PitchGuide displayWords={displayWords} recTime={recTime} pitchGuide={pitchGuide} syncOffset={effectiveOffset} />
          {/* Manual sync trim — compensates for Whisper timing imprecision + audio latency */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-[#1C1C1C] bg-[#060606]">
            <div className="flex flex-col">
              <span className="text-[9px] text-gray-700 tracking-widest">LYRICS SYNC</span>
              <span className="text-[9px] text-gray-800">
                {autoLatency > 0
                  ? `+${autoLatency.toFixed(2)}s auto · ${effectiveOffset > 0 ? '+' : ''}${effectiveOffset.toFixed(2)}s total`
                  : (syncOffset > 0 ? 'Highlight delayed' : syncOffset < 0 ? 'Highlight advanced' : 'No offset')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSyncOffset((v) => Math.max(-1.0, +(v - 0.1).toFixed(2)))}
                className="w-8 h-8 rounded bg-[#161616] hover:bg-[#222] text-amber-400 font-mono text-base leading-none flex items-center justify-center"
                title="Earlier (highlight fires sooner)"
              >−</button>
              <span className="text-xs font-mono text-gray-200 tabular-nums w-14 text-center">
                {syncOffset >= 0 ? '+' : ''}{syncOffset.toFixed(2)}s
              </span>
              <button
                onClick={() => setSyncOffset((v) => Math.min(2.0, +(v + 0.1).toFixed(2)))}
                className="w-8 h-8 rounded bg-[#161616] hover:bg-[#222] text-amber-400 font-mono text-base leading-none flex items-center justify-center"
                title="Later (highlight fires later)"
              >+</button>
              <button
                onClick={() => setSyncOffset(0)}
                className="ml-1 text-[10px] text-gray-600 hover:text-gray-400 px-1.5 py-1"
                title="Reset to 0"
              >reset</button>
            </div>
          </div>
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
