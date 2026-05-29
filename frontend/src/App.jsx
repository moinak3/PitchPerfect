import React, { useState, useCallback, useRef } from 'react'
import SongInput from './components/SongInput'
import RecordingStudio from './components/RecordingStudio'
import AnalysisResults from './components/AnalysisResults'

const S = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  READY: 'ready',
  RECORDING: 'recording',
  ANALYZING: 'analyzing',
  RESULTS: 'results',
}

function Header({ onNewSong, showBack }) {
  return (
    <header className="border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/85 backdrop-blur z-50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center shadow-sm">
          <span className="text-white font-serif italic font-semibold text-base leading-none">P</span>
        </div>
        <h1 className="classic-heading text-2xl font-semibold tracking-tight text-black">
          <span className="text-brand-700">Pitch</span>Perfect
        </h1>
        <span className="hidden sm:inline text-[10px] text-brand-700 border border-brand-200 bg-brand-50 px-2 py-0.5 rounded-full tracking-widest font-medium">
          VOCAL COACH
        </span>
      </div>
      {showBack && (
        <button
          onClick={onNewSong}
          className="text-xs text-gray-600 hover:text-brand-700 transition-colors font-medium"
        >
          ← New Song
        </button>
      )}
    </header>
  )
}

function ProcessingView({ status }) {
  const progress = status?.progress ?? 0
  const message = status?.message ?? 'Initializing...'
  const isError = status?.status === 'error'

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="mb-10 w-full max-w-md">
        <div className="flex items-end justify-center gap-2 mb-4">
          <span
            className={`classic-heading text-6xl font-semibold tabular-nums transition-all duration-500 ${
              isError ? 'text-red-600' : 'text-brand-700'
            }`}
          >
            {progress}
          </span>
          <span className="text-2xl text-gray-400 mb-2 font-light">%</span>
        </div>

        <div className="w-full bg-brand-50 rounded-full h-1.5 mb-5 overflow-hidden ring-1 ring-brand-100">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isError ? 'bg-red-500' : 'progress-shimmer'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className={`text-sm ${isError ? 'text-red-600' : 'text-gray-600'}`}>
          {message}
        </p>
      </div>

      {!isError && (
        <div className="grid grid-cols-3 gap-3 max-w-sm text-center">
          {[
            { step: '1', label: 'SEPARATING', done: progress >= 55 },
            { step: '2', label: 'PITCH DETECT', done: progress >= 70 },
            { step: '3', label: 'TRANSCRIBE', done: progress >= 100 },
          ].map((s) => (
            <div
              key={s.step}
              className={`p-3 rounded-lg border transition-all duration-500 ${
                s.done
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-400'
              }`}
            >
              <div className="text-xs font-semibold">{s.done ? '✓' : s.step}</div>
              <div className="text-[10px] mt-0.5 tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-10 max-w-xs">
        Vocal separation (demucs) typically takes 2–5 minutes depending on song length and your hardware.
      </p>
    </div>
  )
}

function AnalyzingView() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="flex gap-1.5 mb-6 items-end">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-1.5 bg-brand-700 rounded-full animate-pulse"
            style={{
              height: `${16 + Math.random() * 20}px`,
              animationDelay: `${i * 0.12}s`,
              animationDuration: '0.8s',
            }}
          />
        ))}
      </div>
      <div className="classic-heading text-3xl font-semibold mb-2 text-black">
        Analyzing Performance
      </div>
      <div className="text-gray-500 text-sm">
        Running CREPE pitch detection · Whisper alignment · Dynamics scoring
      </div>
    </div>
  )
}

export default function App() {
  const [appState, setAppState] = useState(S.IDLE)
  const [jobId, setJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (id) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/job/${id}`)
          if (!res.ok) return
          const data = await res.json()
          setJobStatus(data)

          if (data.status === 'complete' && data.has_reference) {
            stopPolling()
            setAppState(S.READY)
          } else if (data.status === 'error') {
            stopPolling()
            setError(data.error || 'Processing failed. Check the backend logs.')
            setAppState(S.PROCESSING) // stay on processing view to show error
          }
        } catch (e) {
          console.error('Poll error:', e)
        }
      }, 2500)
    },
    [stopPolling]
  )

  const handleSongSubmit = useCallback(
    async ({ type, url, file, artist = '', songTitle = '' }) => {
      setError(null)
      setAppState(S.PROCESSING)
      setJobStatus({ status: 'starting', progress: 0, message: 'Starting...' })

      try {
        const form = new FormData()
        let endpoint

        if (type === 'youtube') {
          form.append('url', url)
          endpoint = '/api/process-youtube'
        } else {
          form.append('file', file)
          endpoint = '/api/upload-song'
        }
        if (artist) form.append('artist', artist)
        if (songTitle) form.append('song_title', songTitle)

        const res = await fetch(endpoint, { method: 'POST', body: form })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Server error ${res.status}`)
        }

        const { job_id } = await res.json()
        setJobId(job_id)
        startPolling(job_id)
      } catch (e) {
        setError(e.message)
        setAppState(S.IDLE)
      }
    },
    [startPolling]
  )

  const handleRecordingComplete = useCallback(
    async (audioBlob) => {
      setAppState(S.ANALYZING)
      setError(null)

      try {
        const form = new FormData()
        form.append('job_id', jobId)
        form.append('user_audio', audioBlob, 'recording.webm')

        const res = await fetch('/api/analyze', { method: 'POST', body: form })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Analysis server error ${res.status}`)
        }

        const result = await res.json()
        setAnalysisResult(result)
        setAppState(S.RESULTS)
      } catch (e) {
        setError(e.message)
        setAppState(S.READY)
      }
    },
    [jobId]
  )

  const handleRetranscribed = useCallback((newWords, newLyrics) => {
    setJobStatus((prev) => ({
      ...prev,
      words: newWords,
      lyrics: newLyrics,
    }))
  }, [])

  const handleSingAgain = useCallback(() => {
    setAnalysisResult(null)
    setError(null)
    setAppState(S.READY)
  }, [])

  const handleNewSong = useCallback(() => {
    stopPolling()
    setAppState(S.IDLE)
    setJobId(null)
    setJobStatus(null)
    setAnalysisResult(null)
    setError(null)
  }, [stopPolling])

  const showBack = appState !== S.IDLE

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-black font-sans flex flex-col">
      <Header onNewSong={handleNewSong} showBack={showBack} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10">
        {error && appState !== S.PROCESSING && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <span className="font-semibold">Error: </span>
            {error}
          </div>
        )}

        {appState === S.IDLE && <SongInput onSubmit={handleSongSubmit} />}
        {appState === S.PROCESSING && <ProcessingView status={jobStatus} />}

        {(appState === S.READY || appState === S.RECORDING) && (
          <RecordingStudio
            jobId={jobId}
            isRecording={appState === S.RECORDING}
            onRecordingStart={() => setAppState(S.RECORDING)}
            onRecordingStop={() => setAppState(S.READY)}
            onComplete={handleRecordingComplete}
            error={error}
            vocalStartTime={jobStatus?.vocal_start_time ?? 0}
            songDuration={jobStatus?.song_duration ?? 0}
            refWords={jobStatus?.words ?? []}
            sourceLyrics={jobStatus?.lyrics ?? null}
            songTitle={jobStatus?.song_title ?? ''}
            artist={jobStatus?.artist ?? ''}
            onRetranscribed={handleRetranscribed}
            pitchGuide={jobStatus?.pitch_guide ?? null}
          />
        )}

        {appState === S.ANALYZING && <AnalyzingView />}

        {appState === S.RESULTS && analysisResult && (
          <AnalysisResults result={analysisResult} onSingAgain={handleSingAgain} jobId={jobId} />
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="classic-heading text-base text-brand-700 font-semibold">PitchPerfect</span>
            <span>— AI-powered vocal coaching</span>
          </div>
          <div className="flex items-center gap-5">
            <span>Runs locally · no cloud APIs</span>
            <span className="text-gray-300">·</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
