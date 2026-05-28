import React, { useState, useRef, useEffect } from 'react'

export default function ClipPlayer({ src, start, end, label }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef(null)
  const duration = end - start

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const play = () => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = start
    el.play()
    setPlaying(true)

    const check = () => {
      if (el.currentTime >= end) {
        el.pause()
        el.currentTime = start
        setPlaying(false)
      } else {
        rafRef.current = requestAnimationFrame(check)
      }
    }
    rafRef.current = requestAnimationFrame(check)
  }

  const stop = () => {
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.currentTime = start
    setPlaying(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-600 w-16 shrink-0">{label}</span>
      <button
        onClick={playing ? stop : play}
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors shrink-0 ${
          playing
            ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
            : 'bg-[#1A1A1A] border border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A]'
        }`}
      >
        {playing ? '■' : '▶'}
      </button>
      <div className="flex-1 h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${playing ? 'bg-amber-500' : 'bg-[#2A2A2A]'}`}
          style={{ width: playing ? '100%' : '0%', transition: playing ? `width ${duration}s linear` : 'none' }}
        />
      </div>
      <span className="text-[10px] text-gray-700 shrink-0">{duration.toFixed(1)}s</span>
      <audio ref={audioRef} src={src} preload="none" />
    </div>
  )
}
