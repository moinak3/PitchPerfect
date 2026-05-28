import React, { useState } from 'react'
import ClipPlayer from './ClipPlayer'

function ExampleClips({ example, jobId, isTiming = false }) {
  const userStart = example.user_clip_start ?? example.clip_start
  const userEnd = example.user_clip_end ?? example.clip_end
  const hasClip = example.clip_start != null && example.clip_end != null && jobId
  const hasUserClip = example.user_clip_start != null && example.user_clip_end != null

  return (
    <div className="rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-3 space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">{example.description}</p>

      {hasClip && !isTiming && (
        <div className="space-y-1.5">
          <ClipPlayer
            src={`/api/recording/${jobId}`}
            start={userStart}
            end={userEnd}
            label="You sang"
          />
          <ClipPlayer
            src={`/api/audio/${jobId}/vocals`}
            start={example.clip_start}
            end={example.clip_end}
            label="Reference"
          />
        </div>
      )}

      {hasClip && isTiming && (
        <div className="space-y-3">
          {/* Reference clip */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-semibold tracking-widest text-emerald-500/70">REFERENCE — where the word should land</span>
            </div>
            <ClipPlayer
              src={`/api/audio/${jobId}/vocals`}
              start={example.clip_start}
              end={example.clip_end}
              label="Reference"
            />
          </div>

          {/* Divider with timing callout */}
          {example.delta_str && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-[#1E1E1E]" />
              <span className="text-[9px] text-amber-500/60 font-mono shrink-0">
                you were {example.delta_str} {example.direction}
              </span>
              <div className="flex-1 h-px bg-[#1E1E1E]" />
            </div>
          )}

          {/* User clip */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-semibold tracking-widest text-amber-500/70">YOU — where you actually sang it</span>
            </div>
            <ClipPlayer
              src={`/api/recording/${jobId}`}
              start={userStart}
              end={userEnd}
              label="You sang"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DimensionReport({ label, icon, data, jobId, defaultOpen = false, isTiming = false }) {
  const [open, setOpen] = useState(defaultOpen)

  // data can be a plain string (legacy) or { paragraph, examples, tactical_tips }
  const paragraph = typeof data === 'string' ? data : data?.paragraph
  const examples = typeof data === 'string' ? [] : (data?.examples ?? [])
  const tacticalTips = typeof data === 'string' ? [] : (data?.tactical_tips ?? [])

  return (
    <div className="border border-[#1E1E1E] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#111] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-semibold text-gray-200 tracking-wide">{label}</span>
        </div>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[#1A1A1A] space-y-4">
          {paragraph && (
            <p className="text-sm text-gray-400 leading-relaxed">{paragraph}</p>
          )}

          {examples.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-gray-600 tracking-widest font-semibold">
                NOTABLE MOMENTS
              </div>
              {examples.map((ex, i) => (
                <ExampleClips key={i} example={ex} jobId={jobId} isTiming={isTiming} />
              ))}
            </div>
          )}

          {tacticalTips.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-gray-600 tracking-widest font-semibold">
                HOW TO IMPROVE
              </div>
              <ul className="space-y-2">
                {tacticalTips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-400 leading-relaxed">
                    <span className="text-amber-500/60 shrink-0 mt-0.5">→</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CoachingNote({ note, index, jobId }) {
  const fmtTime = (s) => {
    if (!s || s === 0) return null
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const ts = fmtTime(note.timestamp)
  const hasClip = note.clip_start != null && note.clip_end != null && jobId
  const userStart = note.user_clip_start ?? note.clip_start
  const userEnd = note.user_clip_end ?? note.clip_end

  return (
    <div className="flex gap-4 py-4 border-b border-[#131313] last:border-0">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xs font-bold">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-semibold text-gray-300">{note.issue}</span>
          {ts && (
            <span className="text-[10px] bg-[#1A1A1A] border border-[#252525] text-gray-500 px-2 py-0.5 rounded font-mono">
              {ts}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-400 leading-relaxed mb-3">{note.suggestion}</p>
        {hasClip && (
          <div className="space-y-1.5 bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg p-3">
            <ClipPlayer
              src={`/api/recording/${jobId}`}
              start={userStart}
              end={userEnd}
              label="You sang"
            />
            <ClipPlayer
              src={`/api/audio/${jobId}/vocals`}
              start={note.clip_start}
              end={note.clip_end}
              label="Reference"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function CoachingReport({ coachingNotes, coachingReport, jobId }) {
  const hasParagraphs =
    coachingReport?.pitch || coachingReport?.timing || coachingReport?.dynamics

  return (
    <div className="space-y-6">
      {hasParagraphs && (
        <div className="space-y-2">
          {coachingReport.pitch && (
            <DimensionReport
              label="Pitch Accuracy"
              icon="🎵"
              data={coachingReport.pitch}
              jobId={jobId}
              defaultOpen
            />
          )}
          {coachingReport.timing && (
            <DimensionReport
              label="Timing & Rhythm"
              icon="⏱"
              data={coachingReport.timing}
              jobId={jobId}
              isTiming
            />
          )}
          {coachingReport.dynamics && (
            <DimensionReport
              label="Dynamics & Feel"
              icon="🌊"
              data={coachingReport.dynamics}
              jobId={jobId}
            />
          )}
        </div>
      )}

    </div>
  )
}
