import React, { useState, useRef } from 'react'

function FeatureCard({ label, desc, icon }) {
  return (
    <div className="p-5 bg-white border border-gray-200 rounded-xl text-center hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-brand-700 text-[10px] font-semibold tracking-widest mb-1">{label}</div>
      <div className="text-gray-600 text-xs leading-relaxed">{desc}</div>
    </div>
  )
}

export default function SongInput({ onSubmit }) {
  const [tab, setTab] = useState('youtube')
  const [url, setUrl] = useState('https://www.youtube.com/watch?v=vGJTaP6anOU')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [artist, setArtist] = useState('Elvis Presley')
  const [songTitle, setSongTitle] = useState("Can't Help Falling in Love")
  const fileRef = useRef(null)

  const handleYouTubeSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim() || loading) return
    setLoading(true)
    await onSubmit({ type: 'youtube', url: url.trim(), artist: artist.trim(), songTitle: songTitle.trim() })
    setLoading(false)
  }

  const handleFileSubmit = async (e) => {
    e.preventDefault()
    if (!file || loading) return
    setLoading(true)
    await onSubmit({ type: 'file', file, artist: artist.trim(), songTitle: songTitle.trim() })
    setLoading(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const isYouTubeUrl = (s) =>
    s.includes('youtube.com/watch') || s.includes('youtu.be/')

  const inputCls =
    'w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-sm text-black placeholder-gray-400 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 transition-all'

  const submitCls =
    'w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors text-sm tracking-wide shadow-sm'

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      {/* Hero */}
      <div className="text-center mb-12 pt-6">
        <h2 className="classic-heading text-5xl sm:text-6xl font-semibold mb-5 tracking-tight text-black leading-[1.05]">
          Sing. <span className="italic text-brand-700">Score.</span> Improve.
        </h2>
        <p className="text-gray-600 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
          AI-powered vocal coaching. Get word-by-word pitch, timing, and dynamics
          feedback on any song you love.
        </p>
      </div>

      {/* Input card */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-10 shadow-sm">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-brand-50/50">
          {['youtube', 'file'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-4 text-xs font-semibold tracking-widest transition-colors ${
                tab === t
                  ? 'text-brand-700 border-b-2 border-brand-700 bg-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'youtube' ? 'YOUTUBE URL' : 'UPLOAD FILE'}
            </button>
          ))}
        </div>

        <div className="p-7">
          {/* Shared artist / title fields */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-gray-600 tracking-widest mb-2 font-semibold">
                ARTIST <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="e.g. Elvis Presley"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 tracking-widest mb-2 font-semibold">
                SONG TITLE <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="e.g. Can't Help Falling in Love"
                className={inputCls}
              />
            </div>
          </div>
          {(artist || songTitle) && (
            <p className="text-[11px] text-brand-700 mb-5">
              Lyrics will be looked up online and used to improve transcription accuracy.
            </p>
          )}

          {tab === 'youtube' ? (
            <form onSubmit={handleYouTubeSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] text-gray-600 tracking-widest mb-2 font-semibold">
                  PASTE A YOUTUBE LINK
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className={inputCls}
                  autoFocus
                />
                {url && !isYouTubeUrl(url) && (
                  <p className="text-red-600 text-xs mt-1.5">
                    This doesn't look like a YouTube URL.
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !url.trim() || !isYouTubeUrl(url)}
                className={submitCls}
              >
                {loading ? 'Starting…' : 'Analyze Song →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleFileSubmit} className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-brand-600 bg-brand-50 scale-[1.01]'
                    : 'border-gray-300 hover:border-brand-300 hover:bg-brand-50/40'
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg,.flac,.aac"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="hidden"
                />
                {file ? (
                  <div>
                    <div className="text-brand-700 font-semibold text-sm mb-1 truncate">
                      {file.name}
                    </div>
                    <div className="text-gray-500 text-xs">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-3">🎵</div>
                    <div className="text-gray-700 text-sm mb-1 font-medium">
                      Drop audio file or click to browse
                    </div>
                    <div className="text-gray-400 text-xs">
                      MP3 · WAV · M4A · OGG · FLAC · AAC
                    </div>
                  </div>
                )}
              </div>
              <button type="submit" disabled={loading || !file} className={submitCls}>
                {loading ? 'Uploading…' : 'Analyze Song →'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-3 gap-4">
        <FeatureCard icon="🎵" label="PITCH"    desc="Note-by-note accuracy in cents" />
        <FeatureCard icon="⏱"  label="TIMING"   desc="Word-level onset comparison" />
        <FeatureCard icon="🌊" label="DYNAMICS" desc="Energy & vibrato matching" />
      </div>

      <p className="text-center text-xs text-gray-500 mt-10">
        Everything runs locally — no cloud APIs, no data uploaded.
      </p>
    </div>
  )
}
