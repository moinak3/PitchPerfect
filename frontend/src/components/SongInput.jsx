import React, { useState, useRef } from 'react'

function FeatureCard({ label, desc, icon }) {
  return (
    <div className="p-6 bg-white border border-gray-200 rounded-xl text-center hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="text-3xl mb-3">{icon}</div>
      <div className="classic-heading text-lg text-black font-semibold mb-2">{label}</div>
      <div className="text-gray-600 text-sm leading-relaxed">{desc}</div>
    </div>
  )
}

function HowItWorksStep({ n, title, body }) {
  return (
    <div className="relative bg-white border border-gray-200 rounded-2xl p-6">
      <div className="absolute -top-4 left-6 w-9 h-9 rounded-full bg-brand-700 text-white flex items-center justify-center font-serif italic font-semibold text-lg shadow-sm">
        {n}
      </div>
      <h3 className="classic-heading text-xl text-black font-semibold mt-4 mb-2">{title}</h3>
      <p className="text-gray-600 text-sm leading-relaxed">{body}</p>
    </div>
  )
}

function FaqItem({ q, a }) {
  return (
    <details className="group bg-white border border-gray-200 rounded-xl overflow-hidden open:shadow-sm transition-shadow">
      <summary className="cursor-pointer list-none flex items-center justify-between px-5 py-4 text-sm font-medium text-black hover:bg-brand-50/50 transition-colors">
        <span>{q}</span>
        <span className="text-brand-700 text-lg leading-none group-open:rotate-45 transition-transform" aria-hidden>+</span>
      </summary>
      <p className="px-5 pb-5 pt-1 text-sm text-gray-700 leading-relaxed">{a}</p>
    </details>
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

  // Click-to-load a featured song: pre-fills the form, switches to the YouTube
  // tab, and scrolls back to the form so the user can review and hit submit.
  const loadFeatured = ({ url: u, artist: a, songTitle: t }) => {
    setTab('youtube')
    setUrl(u)
    setArtist(a)
    setSongTitle(t)
    document.getElementById('coach-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      <div className="text-center mb-10 pt-6">
        <div className="inline-block text-[10px] tracking-widest text-brand-700 bg-brand-50 border border-brand-200 px-3 py-1 rounded-full mb-5 font-semibold">
          AI VOCAL COACH · RUNS ON YOUR LAPTOP
        </div>
        <h2 className="classic-heading text-4xl sm:text-5xl md:text-6xl font-semibold mb-5 tracking-tight text-black leading-[1.05]">
          Sing any song.<br />
          <span className="italic text-brand-700">Hear how you're really doing.</span>
        </h2>
        <p className="text-gray-600 text-sm sm:text-base md:text-lg max-w-xl mx-auto leading-relaxed">
          PitchPerfect listens like a vocal coach — grading your pitch, timing, and energy on whatever song you bring.
          Word-by-word feedback in five minutes. No catalog, no cloud, no subscription.
        </p>
      </div>

      {/* Input card */}
      <div id="coach-form" className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-10 shadow-sm scroll-mt-24">
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
                {loading ? 'Starting…' : 'Coach me on this song →'}
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

      {/* Featured songs — start with something known-good */}
      <section id="try-a-song" className="mb-20 scroll-mt-24">
        <div className="text-center mb-8">
          <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-2">TRY A SONG</div>
          <h3 className="classic-heading text-3xl sm:text-4xl font-semibold text-black tracking-tight">
            Not sure what to sing? Start here.
          </h3>
        </div>

        {/* Marquee featured card — Can't Help Falling in Love */}
        <button
          onClick={() => loadFeatured({
            url: 'https://www.youtube.com/watch?v=vGJTaP6anOU',
            artist: 'Elvis Presley',
            songTitle: "Can't Help Falling in Love",
          })}
          className="group block w-full text-left bg-gradient-to-br from-brand-50 to-white border border-brand-200 hover:border-brand-400 rounded-2xl p-6 sm:p-8 transition-all hover:shadow-md mb-4"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold tracking-widest text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full">FEATURED</span>
                <span className="text-[10px] text-gray-500">~3 min · slow ballad</span>
              </div>
              <h4 className="classic-heading text-2xl sm:text-3xl font-semibold text-black mb-1 leading-tight">
                Can't Help Falling in Love
              </h4>
              <p className="text-brand-700 italic font-serif text-base sm:text-lg mb-3">Elvis Presley</p>
              <p className="text-gray-600 text-sm leading-relaxed max-w-lg">
                Long held notes and clear lyric phrasing — the perfect first song to test the karaoke timing,
                melody guide, and word-level pitch feedback. Most of our development sessions used this track.
              </p>
            </div>
            <div className="flex items-center gap-2 text-brand-700 group-hover:text-brand-800 font-semibold text-sm shrink-0 self-end sm:self-center">
              Use this song
              <span className="text-lg group-hover:translate-x-1 transition-transform" aria-hidden>→</span>
            </div>
          </div>
        </button>

        {/* Genre trust strip — honest claim about what's been tested */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="text-[10px] font-semibold tracking-widest text-gray-500 shrink-0">TESTED ACROSS</div>
            <div className="flex flex-wrap gap-2">
              {['Slow ballads', 'Pop', 'Rock', 'R&B', 'Classical', 'Indian classical', '~90 languages'].map((g) => (
                <span key={g} className="text-xs bg-brand-50 text-brand-700 border border-brand-100 px-2.5 py-1 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            Pitch detection (pyin) and timing alignment (Whisper) are language- and genre-agnostic —
            anything with a vocal track works.
          </p>
        </div>
      </section>

      {/* Feature outcomes — what you actually get */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-20">
        <FeatureCard
          icon="🎯"
          label="Note-perfect feedback"
          desc="Catch every flat note, sharp note, and wobble — measured in cents, not vibes."
        />
        <FeatureCard
          icon="⏱"
          label="In the pocket"
          desc="See which words rush or drag the beat — to the millisecond, against the original take."
        />
        <FeatureCard
          icon="🌊"
          label="Power where it counts"
          desc="Find the lines where you trail off and the ones where you should be soaring."
        />
      </div>

      {/* How it works */}
      <section id="how-it-works" className="mb-20 scroll-mt-24">
        <div className="text-center mb-10">
          <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-2">THREE STEPS</div>
          <h3 className="classic-heading text-4xl font-semibold text-black tracking-tight">
            How PitchPerfect coaches you
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3">
          <HowItWorksStep
            n="1"
            title="Drop a song"
            body="Paste a YouTube link or upload an audio file. We separate the vocals from the backing track so you can sing along to instrumental — or test yourself against the real vocal take."
          />
          <HowItWorksStep
            n="2"
            title="Sing along"
            body="Press REC and follow the scrolling karaoke. A melody guide above each word shows you exactly which note to hit — like sheet music that moves with you."
          />
          <HowItWorksStep
            n="3"
            title="Get coached"
            body="Word-by-word scores for pitch, timing, and energy. Click any weak word to hear what you sang vs. the original — and what to practice next time."
          />
        </div>
      </section>

      {/* Why PitchPerfect — comparison strip */}
      <section id="why" className="mb-20 scroll-mt-24">
        <div className="text-center mb-8">
          <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-2">WHY PITCHPERFECT</div>
          <h3 className="classic-heading text-4xl font-semibold text-black tracking-tight">
            Built differently on purpose
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: '🎵', title: 'Any song you love', body: 'Not a fixed karaoke catalog — bring any YouTube link or audio file.' },
            { icon: '🔒', title: 'Stays on your laptop',   body: 'Recording, scoring, and analysis run locally. No uploads, no account, no tracking.' },
            { icon: '📈', title: 'Real numbers',           body: 'Cents off, milliseconds off — not just stars and "good job".' },
          ].map((c) => (
            <div key={c.title} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="text-2xl mb-2">{c.icon}</div>
              <div className="font-semibold text-black mb-1.5">{c.title}</div>
              <div className="text-gray-600 text-sm leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mb-16 scroll-mt-24">
        <div className="text-center mb-8">
          <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-2">FAQ</div>
          <h3 className="classic-heading text-4xl font-semibold text-black tracking-tight">
            Common questions
          </h3>
        </div>
        <div className="space-y-3 max-w-2xl mx-auto">
          <FaqItem
            q="Does it work for any song, or just popular ones?"
            a="Any song with a vocal track. We've tested across pop, rock, R&B, classical, Indian classical, and slow ballads. The vocal separation and pitch detection don't care about genre."
          />
          <FaqItem
            q="Is my voice ever uploaded?"
            a="No. Recording, scoring, and analysis all happen on your machine. The only network calls are downloading the YouTube audio you asked for and looking up lyrics — never your voice."
          />
          <FaqItem
            q="Do I need a fancy microphone?"
            a="Your laptop's built-in mic is fine. We grade pitch, timing, and dynamics — not microphone fidelity. Anything that captures voice cleanly works."
          />
          <FaqItem
            q="Does it work for songs in other languages?"
            a="Yes — transcription uses Whisper, which handles ~90 languages out of the box. Pitch and timing scoring is language-agnostic."
          />
          <FaqItem
            q="How long does the first analysis take?"
            a="Two to five minutes for a typical 3–4 minute song. Most of the time goes to vocal separation (the demucs model); after that it's fast. You only do it once per song — re-recording yourself is instant."
          />
          <FaqItem
            q="What if I'd rather just sing without scoring?"
            a="You can. Use the karaoke view to follow the lyrics and target notes without ever submitting your recording for analysis. The melody guide is useful on its own as a practice tool."
          />
        </div>
      </section>

      {/* Final reassurance */}
      <p className="text-center text-xs text-gray-500 mb-4">
        Everything runs locally — no cloud APIs, no data uploaded, no account required.
      </p>
    </div>
  )
}
