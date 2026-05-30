import React, { useEffect, useState } from 'react'
import PitchTimeline from './PitchTimeline'
import PitchContourChart from './PitchContourChart'
import CoachingReport from './CoachingReport'

function CircularGauge({ score, label, size = 130 }) {
  const [display, setDisplay] = useState(0)
  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    let frame = 0
    const total = 70
    const raf = requestAnimationFrame(function tick() {
      frame++
      const t = Math.min(frame / total, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(score * eased))
      if (frame < total) requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [score])

  const strokeDashoffset = circumference - (display / 100) * circumference

  let color, glowColor
  if (display >= 80) {
    color = '#10B981'; glowColor = '#10B98130'
  } else if (display >= 60) {
    color = '#F59E0B'; glowColor = '#F59E0B30'
  } else {
    color = '#EF4444'; glowColor = '#EF444430'
  }

  return (
    <div className="flex flex-col items-center gap-2 animate-score-pop">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#1A1A1A" strokeWidth={9} />
          <circle
            cx={size/2} cy={size/2} r={radius} fill="none"
            stroke={color} strokeWidth={9}
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>{display}</span>
          <span className="text-[10px] text-gray-600">/ 100</span>
        </div>
      </div>
      <span className="text-xs text-gray-400 font-medium tracking-wider">{label}</span>
    </div>
  )
}

function OverallBadge({ score }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    let frame = 0
    const total = 80
    const tick = () => {
      frame++
      const eased = 1 - Math.pow(1 - Math.min(frame / total, 1), 3)
      setDisplay(Math.round(score * eased))
      if (frame < total) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [score])

  const grade =
    display >= 90 ? 'S' : display >= 80 ? 'A' : display >= 70 ? 'B' :
    display >= 60 ? 'C' : display >= 50 ? 'D' : 'F'

  const gradeColor =
    display >= 80 ? 'text-emerald-400' : display >= 60 ? 'text-brand-700' : 'text-red-400'

  return (
    <div className="text-center mb-6 animate-fade-up">
      <div className="inline-flex flex-col items-center bg-white border border-gray-200 rounded-2xl px-10 py-6 shadow-2xl shadow-black/50">
        <div className="text-[10px] text-gray-600 tracking-widest mb-3">OVERALL SCORE</div>
        <div className="flex items-end gap-3">
          <span className={`text-7xl font-bold tabular-nums ${gradeColor}`}>{display}</span>
          <div className="mb-2">
            <span className={`text-2xl font-bold ${gradeColor} opacity-50`}>/100</span>
          </div>
        </div>
        <div className={`text-4xl font-bold mt-2 px-4 py-1 rounded-lg ${gradeColor}`} style={{ fontFamily: 'serif' }}>
          {grade}
        </div>
      </div>
    </div>
  )
}

function FocusSummary({ text }) {
  if (!text) return null
  return (
    <div className="mb-6 bg-brand-50 border border-brand-200 rounded-xl px-5 py-4">
      <div className="text-[10px] text-brand-700 tracking-widest mb-2 font-semibold">COACHING FOCUS</div>
      <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
    </div>
  )
}

function AttemptHistory({ jobId, currentResult }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!jobId) return
    const key = `pp_history_${jobId}`
    const stored = JSON.parse(localStorage.getItem(key) || '[]')
    const entry = {
      ts: Date.now(),
      overall: currentResult.overall_score,
      pitch: currentResult.pitch_score,
      timing: currentResult.timing_score,
      dynamics: currentResult.dynamics_score,
    }
    const updated = [...stored, entry].slice(-10)
    localStorage.setItem(key, JSON.stringify(updated))
    setHistory(updated)
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (history.length < 2) return null

  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  const delta = last.overall - prev.overall

  return (
    <div className="mb-8 bg-white border border-gray-200 rounded-2xl p-5">
      <div className="text-[10px] text-gray-600 tracking-widest mb-4 font-semibold">ATTEMPT HISTORY</div>
      <div className="flex items-end gap-1.5 mb-3">
        {history.map((h, i) => {
          const isLast = i === history.length - 1
          const color = h.overall >= 80 ? '#10B981' : h.overall >= 60 ? '#F59E0B' : '#EF4444'
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className={`text-[9px] tabular-nums ${isLast ? 'text-gray-300' : 'text-gray-700'}`}>
                {h.overall}
              </span>
              <div
                className={`w-full rounded-sm ${isLast ? 'ring-1 ring-brand-600/60' : ''}`}
                style={{
                  height: `${Math.max(4, (h.overall / 100) * 56)}px`,
                  background: color,
                  opacity: isLast ? 1 : 0.35,
                }}
              />
              <span className="text-[9px] text-gray-700">#{i + 1}</span>
            </div>
          )
        })}
      </div>
      <p className={`text-xs ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
        {delta > 0
          ? `↑ +${delta.toFixed(1)} from last attempt`
          : delta < 0
          ? `↓ ${Math.abs(delta).toFixed(1)} from last attempt`
          : 'Same score as last attempt'}
      </p>
    </div>
  )
}

export default function AnalysisResults({ result, onSingAgain, jobId }) {
  const [activeTab, setActiveTab] = useState('breakdown')

  const {
    overall_score,
    pitch_score,
    timing_score,
    dynamics_score,
    word_breakdown,
    coaching_notes,
    coaching_report,
    pitch_contour,
    focus_summary,
  } = result

  const tabs = [
    { id: 'breakdown', label: 'WORD BREAKDOWN' },
    { id: 'contour', label: 'PITCH CHART' },
    { id: 'coaching', label: 'COACHING REPORT' },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      {/* Overall score */}
      <OverallBadge score={overall_score} />

      {/* Focus summary */}
      <FocusSummary text={focus_summary} />

      {/* Attempt history */}
      <AttemptHistory jobId={jobId} currentResult={result} />

      {/* Dimension gauges */}
      <div className="grid grid-cols-3 gap-4 mb-10 bg-white border border-gray-200 rounded-2xl p-6">
        <CircularGauge score={pitch_score} label="PITCH" />
        <CircularGauge score={timing_score} label="TIMING" />
        <CircularGauge score={dynamics_score} label="DYNAMICS" />
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-3 gap-3 mb-8 text-center">
        {[
          {
            label: 'On-pitch words',
            value: word_breakdown.filter((w) => w.pitch_status === 'on_pitch').length,
            total: word_breakdown.length,
            color: 'text-emerald-400',
          },
          {
            label: 'On-time words',
            value: word_breakdown.filter((w) => w.timing_status === 'on_time').length,
            total: word_breakdown.filter((w) => w.timing_status !== 'missing').length,
            color: 'text-brand-700',
          },
          {
            label: 'Coaching tips',
            value: coaching_notes.length,
            total: null,
            color: 'text-sky-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
              {stat.total != null && (
                <span className="text-gray-700 text-sm font-normal">/{stat.total}</span>
              )}
            </div>
            <div className="text-gray-600 text-[10px] mt-1 tracking-wide">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-5 py-3 text-xs font-semibold tracking-widest transition-colors ${
              activeTab === t.id
                ? 'text-brand-700 border-b-2 border-brand-700'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mb-12">
        {activeTab === 'breakdown' && (
          <PitchTimeline wordBreakdown={word_breakdown} jobId={jobId} />
        )}
        {activeTab === 'contour' && (
          <PitchContourChart pitchContour={pitch_contour} wordBreakdown={word_breakdown} />
        )}
        {activeTab === 'coaching' && (
          <CoachingReport
            coachingNotes={coaching_notes}
            coachingReport={coaching_report}
            jobId={jobId}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-center pb-8">
        <button
          onClick={onSingAgain}
          className="px-8 py-3.5 bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded-xl transition-colors text-sm"
        >
          🎤 Sing It Again
        </button>
      </div>
    </div>
  )
}
