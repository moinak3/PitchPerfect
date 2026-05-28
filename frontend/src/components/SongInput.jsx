import React, { useState, useRef } from 'react'

function FeatureCard({ label, desc, icon }) {
  return (
    <div className="p-4 bg-[#0F0F0F] border border-[#1C1C1C] rounded-xl text-center hover:border-amber-500/20 transition-colors">
      <div className="text-lg mb-1">{icon}</div>
      <div className="text-amber-400 text-[10px] font-semibold tracking-widest mb-1">{label}</div>
      <div className="text-gray-600 text-[11px]">{desc}</div>
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

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      {/* Hero */}
      <div className="text-center mb-12 pt-4">
        <h2 className="text-4xl sm:text-5xl font-bold mb-4 tracking-tight">
          <span className="text-amber-400">Sing.</span> Score.{' '}
          <span className="text-amber-400">Improve.</span>
        </h2>
        <p className="text-gray-500 text-sm sm:text-base max-w-md mx-auto leading-relaxed">
          AI-powered vocal coaching. Get word-by-word pitch, timing, and dynamics
          feedback on any song.
        </p>
      </div>

      {/* Input card */}
      <div className="bg-[#0F0F0F] border border-[#1E1E1E] rounded-2xl overflow-hidden mb-8 shadow-2xl shadow-black/40">
        {/* Tabs */}
        <div className="flex border-b border-[#1E1E1E]">
          {['youtube', 'file'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3.5 text-xs font-semibold tracking-wider transition-colors ${
                tab === t
                  ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/3'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {t === 'youtube' ? 'YOUTUBE URL' : 'UPLOAD FILE'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Shared artist / title fields */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-gray-600 tracking-widest mb-1.5">
                ARTIST <span className="text-gray-700">(optional)</span>
              </label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="e.g. Elvis Presley"
                className="w-full bg-[#0A0A0A] border border-[#252525] rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 tracking-widest mb-1.5">
                SONG TITLE <span className="text-gray-700">(optional)</span>
              </label>
              <input
                type="text"
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="e.g. Can't Help Falling in Love"
                className="w-full bg-[#0A0A0A] border border-[#252525] rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>
          </div>
          {(artist || songTitle) && (
            <p className="text-[10px] text-amber-600/70 mb-4">
              Lyrics will be looked up online and used to improve transcription accuracy.
            </p>
          )}

          {tab === 'youtube' ? (
            <form onSubmit={handleYouTubeSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] text-gray-600 tracking-widest mb-2">
                  PASTE A YOUTUBE LINK
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-[#0A0A0A] border border-[#252525] rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-700 focus:outline-none focus:border-amber-500/60 transition-colors"
                  autoFocus
                />
                {url && !isYouTubeUrl(url) && (
                  <p className="text-red-400 text-xs mt-1.5">
                    This doesn't look like a YouTube URL.
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !url.trim() || !isYouTubeUrl(url)}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-[#1A1A1A] disabled:text-gray-700 disabled:cursor-not-allowed text-black font-bold py-3.5 rounded-xl transition-all text-sm tracking-wide"
              >
                {loading ? 'Starting...' : 'Analyze Song →'}
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
                    ? 'border-amber-500 bg-amber-500/5 scale-[1.01]'
                    : 'border-[#252525] hover:border-[#383838]'
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
                    <div className="text-amber-400 font-semibold text-sm mb-1 truncate">
                      {file.name}
                    </div>
                    <div className="text-gray-600 text-xs">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-2xl mb-3">🎵</div>
                    <div className="text-gray-400 text-sm mb-1">
                      Drop audio file or click to browse
                    </div>
                    <div className="text-gray-700 text-xs">
                      MP3 · WAV · M4A · OGG · FLAC · AAC
                    </div>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !file}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-[#1A1A1A] disabled:text-gray-700 disabled:cursor-not-allowed text-black font-bold py-3.5 rounded-xl transition-all text-sm tracking-wide"
              >
                {loading ? 'Uploading...' : 'Analyze Song →'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-3 gap-3">
        <FeatureCard
          icon="🎵"
          label="PITCH"
          desc="Note-by-note accuracy in cents"
        />
        <FeatureCard
          icon="⏱"
          label="TIMING"
          desc="Word-level onset comparison"
        />
        <FeatureCard
          icon="🌊"
          label="DYNAMICS"
          desc="Energy & vibrato matching"
        />
      </div>

      <p className="text-center text-[11px] text-gray-700 mt-8">
        Everything runs locally — no cloud APIs, no data uploaded.
      </p>
    </div>
  )
}
