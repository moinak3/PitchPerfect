import React, { useState, useRef, useEffect } from 'react'
import ClipPlayer from './ClipPlayer'

const STATUS_CONFIG = {
  on_pitch: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    text: 'text-emerald-400',
    activeBg: 'bg-emerald-500/25',
    activeBorder: 'border-emerald-500/70',
    icon: '✓',
    label: 'On pitch',
  },
  slightly_off: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    activeBg: 'bg-amber-500/20',
    activeBorder: 'border-amber-500/60',
    icon: '~',
    label: 'Slightly off',
  },
  way_off: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    activeBg: 'bg-red-500/20',
    activeBorder: 'border-red-500/60',
    icon: '✗',
    label: 'Way off',
  },
  no_data: {
    bg: 'bg-gray-800/30',
    border: 'border-gray-700/30',
    text: 'text-gray-600',
    activeBg: 'bg-gray-700/30',
    activeBorder: 'border-gray-600/50',
    icon: '·',
    label: 'No data',
  },
}

const TIMING_CONFIG = {
  on_time: { icon: '⏱✓', text: 'text-emerald-400' },
  slightly_off: { icon: '⏱~', text: 'text-amber-400' },
  way_off: { icon: '⏱✗', text: 'text-red-400' },
  missing: { icon: '⏱?', text: 'text-gray-600' },
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function fmtNote(hz) {
  if (!hz || hz <= 0) return '—'
  const midi = Math.round(69 + 12 * Math.log2(hz / 440))
  const note = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}${octave}`
}

function fmtMs(ms) {
  if (ms == null) return '—'
  return `${ms > 0 ? '+' : ''}${Math.round(ms)} ms`
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function WordChip({ word, pitchStatus, timingStatus, userPitchHz, refPitchHz, onsetDeltaMs, refStart, refEnd, jobId, expanded, onToggle }) {
  const pc = STATUS_CONFIG[pitchStatus] ?? STATUS_CONFIG.no_data
  const tc = TIMING_CONFIG[timingStatus] ?? TIMING_CONFIG.missing
  const hasClip = refStart != null && refEnd != null && jobId
  const clipStart = Math.max(0, refStart - 0.5)
  const clipEnd = refEnd + 0.5

  return (
    <div className="inline-block">
      {/* Chip */}
      <div
        onClick={hasClip ? onToggle : undefined}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm select-none transition-all ${
          hasClip ? 'cursor-pointer hover:scale-105' : 'cursor-default'
        } ${
          expanded
            ? `${pc.activeBg} ${pc.activeBorder}`
            : `${pc.bg} ${pc.border}`
        }`}
      >
        <span className={`text-xs font-bold ${pc.text}`}>{pc.icon}</span>
        <span className="text-gray-200">{word}</span>
        {hasClip && (
          <span className="text-[9px] text-gray-600 ml-0.5">{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {/* Expanded inline clip panel */}
      {expanded && hasClip && (
        <div className="mt-1 mb-1 bg-[#0A0A0A] border border-[#1E1E1E] rounded-xl p-3 w-72 shadow-xl space-y-2">
          {/* Info row */}
          <div className="flex gap-3 text-[10px] text-gray-500 border-b border-[#1A1A1A] pb-2 mb-1">
            <span>
              <span className="text-gray-600">Time </span>
              <span className="text-gray-300 font-mono">{fmtTime(refStart)}</span>
            </span>
            <span>
              <span className="text-gray-600">Your note </span>
              <span className={pc.text}>{fmtNote(userPitchHz)}</span>
            </span>
            <span>
              <span className="text-gray-600">Target </span>
              <span className="text-gray-300">{fmtNote(refPitchHz)}</span>
            </span>
            <span className={`${tc.text}`}>
              {fmtMs(onsetDeltaMs)}
            </span>
          </div>
          <ClipPlayer
            src={`/api/recording/${jobId}`}
            start={clipStart}
            end={clipEnd}
            label="You sang"
          />
          <ClipPlayer
            src={`/api/audio/${jobId}/vocals`}
            start={clipStart}
            end={clipEnd}
            label="Reference"
          />
        </div>
      )}
    </div>
  )
}

export default function PitchTimeline({ wordBreakdown, jobId }) {
  const [expandedIdx, setExpandedIdx] = useState(null)

  if (!wordBreakdown?.length) return null

  const scored = wordBreakdown.filter((w) => w.pitch_status !== 'no_data')
  const skipped = wordBreakdown.length - scored.length

  const onPitch = scored.filter((w) => w.pitch_status === 'on_pitch').length
  const slightlyOff = scored.filter((w) => w.pitch_status === 'slightly_off').length
  const wayOff = scored.filter((w) => w.pitch_status === 'way_off').length
  const total = scored.length

  const toggle = (i) => setExpandedIdx((prev) => (prev === i ? null : i))

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          On pitch ({onPitch})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          Slightly off ({slightlyOff})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Way off ({wayOff})
        </span>
        <span className="flex items-center gap-1.5 ml-auto">
          {total} words sung
          {skipped > 0 && <span className="text-gray-700">· {skipped} not recorded</span>}
        </span>
      </div>

      {jobId && (
        <p className="text-[10px] text-gray-700 mb-4">
          Click any word to hear your recording vs the reference at that moment.
        </p>
      )}

      {total === 0 && (
        <div className="text-center py-10 text-gray-600 text-sm">
          No sung words detected — try recording a longer section where the vocals are active.
        </div>
      )}

      <div className="flex flex-wrap gap-2 leading-loose">
        {scored.map((w, i) => (
          <WordChip
            key={i}
            word={w.word}
            pitchStatus={w.pitch_status}
            timingStatus={w.timing_status}
            userPitchHz={w.user_pitch_hz}
            refPitchHz={w.ref_pitch_hz}
            onsetDeltaMs={w.onset_delta_ms}
            refStart={w.ref_start}
            refEnd={w.ref_end}
            jobId={jobId}
            expanded={expandedIdx === i}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>
    </div>
  )
}
