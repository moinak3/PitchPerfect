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

// Illustrative preview of the live recording interface — styled to match the
// real KaraokeDisplay + PitchGuide components.  Not a screenshot; a hand-built
// React/SVG mock that stays in sync with the brand and updates instantly.
function LiveSingingPreview() {
  const words = [
    { text: 'Wise',  note: 'C#3', state: 'past' },
    { text: 'men',   note: 'D3',  state: 'past' },
    { text: 'say',   note: 'F#3', state: 'current' },
    { text: 'only',  note: 'F3',  state: 'upcoming' },
    { text: 'fools', note: 'D#3', state: 'upcoming' },
    { text: 'rush',  note: 'F3',  state: 'upcoming' },
    { text: 'in',    note: 'D3',  state: 'upcoming' },
  ]
  return (
    <div className="bg-[#0B0A12] border border-[#2A2438] rounded-2xl overflow-hidden shadow-xl">
      {/* Status strip */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#13111C] border-b border-[#2A2438]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-[10px] text-red-300 tracking-widest font-mono">REC 0:42</span>
        </div>
        <span className="text-[10px] text-gray-500 tracking-widest font-mono hidden sm:inline">
          CAN'T HELP FALLING IN LOVE
        </span>
      </div>

      {/* Karaoke line */}
      <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-1 px-4 py-4 min-h-[60px]">
        {words.map((w) => (
          <div key={w.text} className="flex flex-col items-center">
            <span
              className={`text-lg font-bold leading-none ${
                w.state === 'current'
                  ? 'text-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                  : w.state === 'past'
                  ? 'text-gray-700'
                  : 'text-gray-500'
              }`}
            >
              {w.text}
            </span>
            <span
              className={`text-[9px] font-mono leading-none mt-1.5 ${
                w.state === 'current'
                  ? 'text-amber-300/90'
                  : w.state === 'past'
                  ? 'text-gray-800'
                  : 'text-emerald-700/70'
              }`}
            >
              {w.note}
            </span>
          </div>
        ))}
      </div>

      {/* Melody guide */}
      <div className="border-t border-[#2A2438] px-2 pt-2 pb-3">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[9px] text-gray-700 tracking-widest">MELODY GUIDE</span>
          <span className="text-[10px] font-mono text-brand-300 bg-brand-900/40 border border-brand-700/40 px-2 py-0.5 rounded">
            ♪ sing F#3
          </span>
        </div>
        <svg viewBox="0 0 640 180" className="block w-full" preserveAspectRatio="none">
          <rect x="36" y="8" width="596" height="160" fill="#050505" />
          {/* C-note gridlines */}
          {[
            { y: 30,  label: 'D4' },
            { y: 90,  label: 'C4' },
            { y: 150, label: 'B3' },
          ].map((g) => (
            <g key={g.label}>
              <line x1="36" y1={g.y} x2="632" y2={g.y} stroke="#1A1A1A" strokeWidth="1" />
              <text x="33" y={g.y + 3} textAnchor="end" fontSize="9" fill="#555" fontFamily="monospace">{g.label}</text>
            </g>
          ))}
          {/* Dashed connector between word-note centres */}
          <polyline
            points="80,120 180,90 280,70 380,80 480,100 580,60"
            fill="none" stroke="#3A4A44" strokeWidth="1" strokeDasharray="2 2"
          />
          {/* Note bars: past (dim), current (amber), upcoming (green) */}
          <rect x="60"  y="116" width="80" height="8" rx="4" fill="#2C3A35" fillOpacity="0.55" />
          <rect x="160" y="86"  width="80" height="8" rx="4" fill="#2C3A35" fillOpacity="0.55" />
          <rect x="260" y="66"  width="80" height="8" rx="4" fill="#F59E0B" />
          <text x="300" y="58" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#FCD34D" fontFamily="monospace">F#3</text>
          <rect x="360" y="76"  width="80" height="8" rx="4" fill="#10B981" fillOpacity="0.85" />
          <text x="400" y="68" textAnchor="middle" fontSize="11" fill="#6B7B75" fontFamily="monospace">F3</text>
          <rect x="460" y="96"  width="80" height="8" rx="4" fill="#10B981" fillOpacity="0.85" />
          <text x="500" y="88" textAnchor="middle" fontSize="11" fill="#6B7B75" fontFamily="monospace">D#3</text>
          <rect x="560" y="56"  width="60" height="8" rx="4" fill="#10B981" fillOpacity="0.85" />
          {/* Now cursor */}
          <line x1="300" y1="8" x2="300" y2="168" stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.7" />
          <polygon points="296,8 304,8 300,15" fill="#F59E0B" fillOpacity="0.7" />
        </svg>
      </div>
    </div>
  )
}

// Illustrative preview of the coaching report.  Same caveat as above.
function CoachingReportPreview() {
  const stats = [
    { label: 'PITCH',    value: 91, color: 'text-emerald-700' },
    { label: 'TIMING',   value: 84, color: 'text-brand-700' },
    { label: 'DYNAMICS', value: 86, color: 'text-emerald-700' },
  ]
  const wordRows = [
    { word: 'Wise',    delta: 'on',       score: 95 },
    { word: 'men',     delta: '+18¢ sharp', score: 80 },
    { word: 'say',     delta: 'on',       score: 92 },
    { word: 'only',    delta: '+35¢ sharp', score: 64 },
    { word: 'fools',   delta: 'on',       score: 88 },
    { word: 'falling', delta: '-22¢ flat',  score: 73 },
  ]
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl">
      {/* Score */}
      <div className="text-center pt-7 pb-5 px-6 border-b border-gray-100">
        <div className="text-[10px] text-gray-500 tracking-widest mb-3 font-semibold">OVERALL SCORE</div>
        <div className="flex items-end justify-center gap-3 mb-1">
          <span className="classic-heading text-6xl font-semibold text-brand-700 tabular-nums leading-none">87</span>
          <span className="text-2xl text-gray-300 mb-1 font-light">/100</span>
        </div>
        <div className="classic-heading text-3xl font-semibold text-brand-700 mt-1">B+</div>
      </div>

      {/* Focus callout */}
      <div className="bg-brand-50 border border-brand-200 mx-5 mt-4 rounded-xl px-4 py-3">
        <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-1.5">COACHING FOCUS</div>
        <p className="text-xs text-gray-700 leading-relaxed">
          Pitch is strong on sustained notes — work on the transitions in <em>"only fools"</em>,
          where you went sharp by ~35 cents.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3 px-5 mt-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 tracking-widest mb-1">{s.label}</div>
            <div className={`text-2xl font-semibold tabular-nums ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Word-by-word */}
      <div className="px-5 pt-4 pb-5">
        <div className="text-[10px] tracking-widest text-gray-500 font-semibold mb-2">WORD-BY-WORD</div>
        <div className="space-y-1.5">
          {wordRows.map((w) => (
            <div key={w.word} className="flex items-center gap-3 text-xs">
              <span className="w-16 font-medium text-black truncate">{w.word}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    w.score >= 90 ? 'bg-emerald-500'
                      : w.score >= 75 ? 'bg-brand-500'
                      : 'bg-orange-400'
                  }`}
                  style={{ width: `${w.score}%` }}
                />
              </div>
              <span
                className={`text-[10px] font-mono w-20 text-right ${
                  w.score >= 90 ? 'text-emerald-700' : 'text-gray-500'
                }`}
              >
                {w.delta}
              </span>
            </div>
          ))}
        </div>
      </div>
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

      {/* See it at work — illustrative previews of the two main views */}
      <section id="see-it" className="mb-20 scroll-mt-24">
        <div className="text-center mb-10">
          <div className="text-[10px] tracking-widest text-brand-700 font-semibold mb-2">SEE IT AT WORK</div>
          <h3 className="classic-heading text-3xl sm:text-4xl font-semibold text-black tracking-tight">
            What you'll see while you sing
          </h3>
        </div>

        {/* Live singing interface */}
        <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-center mb-14">
          <div>
            <h4 className="classic-heading text-2xl sm:text-3xl font-semibold text-black mb-3 leading-tight">
              Sing with a melody you can see.
            </h4>
            <p className="text-gray-700 text-base leading-relaxed mb-3">
              The karaoke line tells you what word is coming.
              The melody guide above it shows the <em>exact note</em> to hit — on a stable musical scale.
            </p>
            <p className="text-gray-600 text-sm leading-relaxed">
              Watch the pitch rise and fall through the song as the cursor moves
              underneath each word. No more guessing the target — it's right there in front of you.
            </p>
          </div>
          <div className="md:order-last">
            <LiveSingingPreview />
          </div>
        </div>

        {/* Coaching report */}
        <div className="grid md:grid-cols-2 gap-8 md:gap-10 items-center">
          <div className="md:order-2">
            <h4 className="classic-heading text-2xl sm:text-3xl font-semibold text-black mb-3 leading-tight">
              Get a coach's reading of every line.
            </h4>
            <p className="text-gray-700 text-base leading-relaxed mb-3">
              Word-by-word: how flat or sharp you were (in cents),
              where you rushed or dragged the beat,
              and where you trailed off when you should have powered through.
            </p>
            <p className="text-gray-600 text-sm leading-relaxed">
              Then one focused summary on the single thing to work on next time —
              not just a star rating.
            </p>
          </div>
          <div className="md:order-1">
            <CoachingReportPreview />
          </div>
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
