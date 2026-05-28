import React, { useState, useMemo, useRef, useCallback } from 'react'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function hzToMidi(hz) {
  if (!hz || hz <= 0) return null
  return 12 * Math.log2(hz / 440) + 69
}

function midiToLabel(midi) {
  const r = Math.round(midi)
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1)
}

function fmtTime(t) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

// Linear interpolation of MIDI at time t using the nearest voiced frames
function interpolateMidiAt(times, hzArr, t) {
  if (!times.length) return null
  // Binary search for insertion point
  let lo = 0, hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  // Walk outward from lo to find the two bracketing voiced frames
  let left = lo, right = lo
  while (left > 0 && (!hzArr[left] || hzArr[left] <= 0)) left--
  while (right < times.length - 1 && (!hzArr[right] || hzArr[right] <= 0)) right++

  const mLeft = hzToMidi(hzArr[left])
  const mRight = hzToMidi(hzArr[right])
  if (!mLeft) return null
  if (left === right) return mLeft
  if (times[right] - times[left] > 1.5) return null // voiced frames too far apart
  const frac = Math.max(0, Math.min(1, (t - times[left]) / (times[right] - times[left])))
  return mLeft + (mRight - mLeft) * frac
}

const CENTS_ON = 50
const CENTS_SLIGHT = 150

function segmentColor(centsDiff) {
  if (centsDiff == null) return '#6B7280'
  const abs = Math.min(Math.abs(centsDiff), Math.abs(Math.abs(centsDiff) - 1200))
  if (abs <= CENTS_ON) return '#10B981'
  if (abs <= CENTS_SLIGHT) return '#F59E0B'
  return '#EF4444'
}

function pitchStatus(centsDiff) {
  if (centsDiff == null) return null
  const abs = Math.min(Math.abs(centsDiff), Math.abs(Math.abs(centsDiff) - 1200))
  if (abs <= CENTS_ON) return 'on'
  if (abs <= CENTS_SLIGHT) return 'slight'
  return 'off'
}

export default function PitchContourChart({ pitchContour, wordBreakdown }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const { ref_times = [], ref_hz = [], user_times = [], user_hz = [] } = pitchContour ?? {}

  const layout = useMemo(() => {
    const W = 860, H = 240, PL = 44, PR = 16, PT = 16, PB = 28
    const cW = W - PL - PR
    const cH = H - PT - PB

    const allMidi = [...ref_hz, ...user_hz].map(hzToMidi).filter(Boolean)
    if (!allMidi.length) return null

    const midiMin = Math.floor(Math.min(...allMidi)) - 1
    const midiMax = Math.ceil(Math.max(...allMidi)) + 1
    const maxTime = Math.max(
      ref_times.length ? ref_times[ref_times.length - 1] : 0,
      user_times.length ? user_times[user_times.length - 1] : 0,
      1,
    )

    const tx = t => PL + (t / maxTime) * cW
    const ty = m => PT + cH - ((m - midiMin) / (midiMax - midiMin)) * cH

    // C note Y-axis labels
    const cNotes = []
    for (let m = Math.ceil(midiMin); m <= midiMax; m++) {
      if (m % 12 === 0) cNotes.push(m)
    }

    // X axis ticks every 30s
    const xTicks = []
    for (let t = 0; t <= maxTime; t += 30) xTicks.push(t)

    return { W, H, PL, PR, PT, PB, cW, cH, tx, ty, maxTime, midiMin, midiMax, cNotes, xTicks }
  }, [ref_times, ref_hz, user_times, user_hz])

  // Reference line segments (split on voiced gaps)
  const refPolylines = useMemo(() => {
    if (!layout) return []
    const { tx, ty } = layout
    const segs = []
    let cur = []
    for (let i = 0; i < ref_times.length; i++) {
      const m = hzToMidi(ref_hz[i])
      if (!m) { if (cur.length) { segs.push(cur); cur = [] }; continue }
      if (cur.length && ref_times[i] - ref_times[i - 1] > 1.2) { segs.push(cur); cur = [] }
      cur.push(`${tx(ref_times[i]).toFixed(1)},${ty(m).toFixed(1)}`)
    }
    if (cur.length) segs.push(cur)
    return segs
  }, [layout, ref_times, ref_hz])

  // On-pitch zone polygons (±50 cents = ±0.5 MIDI around reference)
  const zonePaths = useMemo(() => {
    if (!layout) return []
    const { tx, ty } = layout
    const paths = []
    let top = [], bot = []
    const flush = () => {
      if (top.length > 1) paths.push([...top, ...bot.reverse()].join(' '))
      top = []; bot = []
    }
    for (let i = 0; i < ref_times.length; i++) {
      const m = hzToMidi(ref_hz[i])
      if (!m) { flush(); continue }
      if (top.length && ref_times[i] - ref_times[i - 1] > 1.2) flush()
      top.push(`${tx(ref_times[i]).toFixed(1)},${ty(m + 0.5).toFixed(1)}`)
      bot.push(`${tx(ref_times[i]).toFixed(1)},${ty(m - 0.5).toFixed(1)}`)
    }
    flush()
    return paths
  }, [layout, ref_times, ref_hz])

  // Colored user line — one <line> per consecutive voiced pair
  const userLines = useMemo(() => {
    if (!layout) return []
    const { tx, ty } = layout
    const lines = []
    for (let i = 0; i < user_times.length - 1; i++) {
      const m0 = hzToMidi(user_hz[i])
      const m1 = hzToMidi(user_hz[i + 1])
      if (!m0 || !m1) continue
      if (user_times[i + 1] - user_times[i] > 1.2) continue
      const refM = interpolateMidiAt(ref_times, ref_hz, user_times[i])
      const cents = refM != null ? Math.round((m0 - refM) * 100) : null
      lines.push({
        x1: tx(user_times[i]), y1: ty(m0),
        x2: tx(user_times[i + 1]), y2: ty(m1),
        color: segmentColor(cents),
      })
    }
    return lines
  }, [layout, user_times, user_hz, ref_times, ref_hz])

  const handleMouseMove = useCallback((e) => {
    if (!layout || !svgRef.current) return
    const { W, PL, cW, maxTime, PT, PB, H } = layout
    const rect = svgRef.current.getBoundingClientRect()
    // Map client X → SVG coordinate
    const svgX = (e.clientX - rect.left) / rect.width * W
    const time = (svgX - PL) / cW * maxTime
    if (time < 0 || time > maxTime + 0.5) { setHover(null); return }

    const refMidi = interpolateMidiAt(ref_times, ref_hz, time)
    const userMidi = interpolateMidiAt(user_times, user_hz, time)
    const centsDiff = refMidi && userMidi ? Math.round((userMidi - refMidi) * 100) : null
    const status = pitchStatus(centsDiff)

    const word = wordBreakdown?.find(
      w => time >= (w.ref_start ?? 0) && time <= (w.ref_end ?? w.ref_start + 1),
    )

    setHover({
      svgX: Math.max(PL, Math.min(PL + cW, svgX)),
      time,
      refMidi,
      userMidi,
      centsDiff,
      status,
      word,
    })
  }, [layout, ref_times, ref_hz, user_times, user_hz, wordBreakdown])

  if (!layout) {
    return (
      <div className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl p-8 text-center text-gray-600 text-sm">
        Not enough pitch data to display chart.
      </div>
    )
  }

  const { W, H, PL, PT, PB, cW, cH, tx, ty, cNotes, xTicks } = layout

  // Tooltip X flip: if cursor is past 65% of chart width, show tooltip to the left
  const tooltipX = hover
    ? (hover.svgX > W * 0.65 ? hover.svgX - 172 : hover.svgX + 12)
    : 0
  const tooltipY = PT + 6

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Hover over the chart to see notes and drift at any moment
      </p>
      <div className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl overflow-x-auto">
        <svg
          ref={svgRef}
          width={W}
          height={H}
          className="block cursor-crosshair"
          style={{ minWidth: W }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Chart background */}
          <rect x={PL} y={PT} width={cW} height={cH} fill="#060606" rx="3" />

          {/* On-pitch zone */}
          {zonePaths.map((pts, i) => (
            <polygon key={i} points={pts} fill="#10B981" fillOpacity="0.07" />
          ))}

          {/* Y grid + note labels */}
          {cNotes.map(m => (
            <g key={m}>
              <line x1={PL} y1={ty(m)} x2={PL + cW} y2={ty(m)} stroke="#1E1E1E" strokeWidth="1" />
              <text x={PL - 5} y={ty(m) + 4} textAnchor="end" fontSize="9" fill="#555">
                {midiToLabel(m)}
              </text>
            </g>
          ))}

          {/* X grid + time labels */}
          {xTicks.map(t => (
            <g key={t}>
              <line x1={tx(t)} y1={PT} x2={tx(t)} y2={PT + cH} stroke="#1A1A1A" strokeWidth="1" />
              <text x={tx(t)} y={H - PB + 16} textAnchor="middle" fontSize="9" fill="#444">
                {fmtTime(t)}
              </text>
            </g>
          ))}

          {/* Reference melody — dashed, subtle */}
          {refPolylines.map((pts, i) => (
            <polyline
              key={i}
              points={pts.join(' ')}
              fill="none"
              stroke="#10B981"
              strokeWidth="1.5"
              strokeOpacity="0.35"
              strokeDasharray="5,4"
              strokeLinejoin="round"
            />
          ))}

          {/* User pitch — colored per segment */}
          {userLines.map((s, i) => (
            <line
              key={i}
              x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke={s.color}
              strokeWidth="2"
              strokeOpacity="0.9"
              strokeLinecap="round"
            />
          ))}

          {/* Hover crosshair */}
          {hover && (
            <line
              x1={hover.svgX} y1={PT}
              x2={hover.svgX} y2={PT + cH}
              stroke="#fff"
              strokeWidth="1"
              strokeOpacity="0.12"
              strokeDasharray="3,3"
            />
          )}

          {/* Hover data dots */}
          {hover?.refMidi && (
            <circle cx={hover.svgX} cy={ty(hover.refMidi)} r="4" fill="#10B981" fillOpacity="0.7" />
          )}
          {hover?.userMidi && (
            <circle
              cx={hover.svgX} cy={ty(hover.userMidi)} r="4.5"
              fill={
                hover.status === 'on' ? '#10B981' :
                hover.status === 'slight' ? '#F59E0B' : '#EF4444'
              }
              fillOpacity="1"
            />
          )}

          {/* Hover tooltip as foreignObject */}
          {hover && (hover.refMidi || hover.userMidi) && (
            <foreignObject x={tooltipX} y={tooltipY} width="165" height="130" style={{ overflow: 'visible' }}>
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  background: '#111',
                  border: '1px solid #2A2A2A',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '11px',
                  lineHeight: '1.5',
                  pointerEvents: 'none',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                  whiteSpace: 'nowrap',
                }}
              >
                <div style={{ color: '#666', fontFamily: 'monospace', marginBottom: '4px' }}>
                  {fmtTime(hover.time)}
                </div>
                {hover.word && (
                  <div style={{ color: '#ddd', fontWeight: '600', fontSize: '13px', marginBottom: '5px' }}>
                    "{hover.word.word}"
                  </div>
                )}
                {hover.refMidi && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: '#888' }}>
                    <span>Reference</span>
                    <span style={{ color: '#10B981', fontFamily: 'monospace' }}>{midiToLabel(hover.refMidi)}</span>
                  </div>
                )}
                {hover.userMidi && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: '#888' }}>
                    <span>You sang</span>
                    <span style={{
                      fontFamily: 'monospace',
                      color: hover.status === 'on' ? '#10B981' : hover.status === 'slight' ? '#F59E0B' : '#EF4444',
                    }}>
                      {midiToLabel(hover.userMidi)}
                    </span>
                  </div>
                )}
                {hover.centsDiff != null && (
                  <div style={{
                    marginTop: '5px',
                    textAlign: 'center',
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    borderRadius: '6px',
                    padding: '2px 8px',
                    background: hover.status === 'on' ? 'rgba(16,185,129,0.12)' :
                                hover.status === 'slight' ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                    color: hover.status === 'on' ? '#10B981' :
                           hover.status === 'slight' ? '#F59E0B' : '#EF4444',
                  }}>
                    {hover.centsDiff > 0 ? '+' : ''}{hover.centsDiff}¢
                    {' '}
                    {hover.status === 'on' ? '✓ on pitch' : hover.centsDiff > 0 ? 'sharp' : 'flat'}
                  </div>
                )}
              </div>
            </foreignObject>
          )}

          {/* Axis borders */}
          <line x1={PL} y1={PT} x2={PL} y2={PT + cH} stroke="#2A2A2A" strokeWidth="1" />
          <line x1={PL} y1={PT + cH} x2={PL + cW} y2={PT + cH} stroke="#2A2A2A" strokeWidth="1" />
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-5 text-xs">
        <span className="flex items-center gap-2 text-gray-600">
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#10B981" strokeWidth="1.5" strokeDasharray="5,4" strokeOpacity="0.5"/></svg>
          Reference
        </span>
        <span className="flex items-center gap-2 text-emerald-400">
          <span className="block w-5 h-0.5 bg-emerald-500 rounded" />
          On pitch (±50¢)
        </span>
        <span className="flex items-center gap-2 text-amber-400">
          <span className="block w-5 h-0.5 bg-amber-500 rounded" />
          Slightly off (±150¢)
        </span>
        <span className="flex items-center gap-2 text-red-400">
          <span className="block w-5 h-0.5 bg-red-500 rounded" />
          Way off
        </span>
        <span className="flex items-center gap-2 text-gray-600">
          <span className="block w-4 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.2)' }} />
          On-pitch zone
        </span>
      </div>
    </div>
  )
}
