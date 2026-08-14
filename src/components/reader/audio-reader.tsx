'use client'

import { logger } from '@/lib/logger'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Headphones,
  Timer,
  X,
} from 'lucide-react'
import type { BookRecord } from '@/lib/library'
import { extractAudioTracks, type AudioTrack } from '@/lib/book-parser'
import { useReadingTracker } from '@/hooks/use-reading-tracker'
import { useReaderStore } from '@/store/reader-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

// Sleep timer presets (minutes). 0 = off.
const SLEEP_TIMER_OPTIONS = [0, 10, 20, 30, 45, 60, 90]

interface Props {
  book: BookRecord
  onProgress: (p: number, extra?: { audioTrack?: number; audioTime?: number }) => void
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AudioReader({ book, onProgress }: Props) {
  const [tracks, setTracks] = useState<AudioTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [currentTrack, setCurrentTrack] = useState(book.audioTrack ?? 0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(book.audioTime ?? 0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [pagesFlipped, setPagesFlipped] = useState(0)
  const [trackUrls, setTrackUrls] = useState<string[]>([])
  // Sleep timer: sleepEndsAt is a timestamp (ms) when playback should pause.
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null)
  const [sleepRemaining, setSleepRemaining] = useState<number>(0)

  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef(currentTrack)
  const currentTrackRef = useRef(currentTrack)
  currentTrackRef.current = currentTrack
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const playingRef = useRef(false)
  const autoAdvanceRef = useRef(false)
  const didRestoreRef = useRef(false)
  const settings = useReaderStore((s) => s.settings)

  // Track reading time only while audio is actually playing — a paused
  // session (manual pause, sleep timer) must not be credited as reading time.
  useReadingTracker(book.id, pagesFlipped, isPlaying)

  // Extract tracks from ZIP or use single MP3
  useEffect(() => {
    let cancelled = false
    const revoked: string[] = []

    setLoading(true)
    ;(async () => {
      try {
        const isZip =
          book.blob.type === 'application/zip' ||
          book.blob.type === 'application/x-zip-compressed'
        let parsedTracks: AudioTrack[]

        if (isZip || book.blob.size > 0) {
          parsedTracks = await extractAudioTracks(book.blob)
          if (parsedTracks.length === 0) {
            // Maybe it's a plain MP3 (not zipped)
            parsedTracks = [
              {
                name: book.title,
                blob: book.blob,
                size: book.blob.size,
              },
            ]
          }
        } else {
          parsedTracks = []
        }

        if (cancelled) return

        setTracks(parsedTracks)
        // Create object URLs for all tracks
        const urls = parsedTracks.map((t) => {
          const url = URL.createObjectURL(t.blob)
          revoked.push(url)
          return url
        })
        setTrackUrls(urls)
        setCurrentTrack((prev) => Math.max(0, Math.min(prev, parsedTracks.length - 1)))
      } catch (e) {
        logger.error('Audio track extraction failed', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      for (const url of revoked) URL.revokeObjectURL(url)
    }
  }, [book.id, book.blob, book.title])

  // Audio element event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }
    const onDurationChange = () => {
      setDuration(audio.duration || 0)
    }
    const onEnded = () => {
      // Auto-advance to next track and keep playing
      autoAdvanceRef.current = true
      if (currentTrackRef.current < tracks.length - 1) {
        setCurrentTrack(currentTrackRef.current + 1)
      } else {
        setIsPlaying(false)
        // The book ended on its own — a pending sleep timer is moot
        setSleepEndsAt(null)
        setSleepRemaining(0)
      }
    }
    const onPlay = () => {
      playingRef.current = true
      setIsPlaying(true)
    }
    const onPause = () => {
      playingRef.current = false
      setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
}, [tracks.length])

  // Restore position when track changes; count user-initiated track flips
  useEffect(() => {
    if (trackRef.current !== currentTrack) {
      trackRef.current = currentTrack
      setPagesFlipped((n) => n + 1)
    }
    const audio = audioRef.current
    if (!audio || trackUrls.length === 0) return

    const url = trackUrls[currentTrack]
    if (!url) return

    // Seek to the saved position only on the first load of the initial
    // track — coming back to that track mid-session must not reset the
    // in-session position (and a remount must not seek again).
    const restore = currentTrack === (book.audioTrack ?? 0) && !didRestoreRef.current
    if (restore) didRestoreRef.current = true

    // After an ended auto-advance or a manual switch while playing, keep
    // playback going — loading the new source must not stall the session.
    const shouldPlay = autoAdvanceRef.current || playingRef.current
    autoAdvanceRef.current = false

    audio.src = url
    audio.load()

    const onLoadedMetadata = () => {
      if (restore) {
        const saved = book.audioTime ?? 0
        if (saved > 0 && saved < audio.duration) {
          audio.currentTime = saved
        }
      }
      audio.playbackRate = playbackRate
      audio.volume = volume
      audio.muted = muted
      if (shouldPlay) audio.play().catch(() => {})
    }
    audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [currentTrack, trackUrls])

  // Keep the audio element in sync with volume/mute/rate controls
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
    audio.playbackRate = playbackRate
  }, [volume, muted, playbackRate])

  // Sleep timer countdown: tick every second, pause when the time is up.
  useEffect(() => {
    if (!sleepEndsAt) return
    const tick = () => {
      const remaining = sleepEndsAt - Date.now()
      setSleepRemaining(Math.max(0, Math.ceil(remaining / 1000)))
      if (remaining <= 0) {
        setSleepEndsAt(null)
        setSleepRemaining(0)
        audioRef.current?.pause()
        toast.success('Таймер сна: воспроизведение остановлено')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sleepEndsAt])

  // Set the sleep timer to `minutes` from now (0 disables it).
  const setSleepTimer = useCallback((minutes: number) => {
    if (minutes <= 0) {
      setSleepEndsAt(null)
      setSleepRemaining(0)
      return
    }
    setSleepEndsAt(Date.now() + minutes * 60000)
    setSleepRemaining(minutes * 60)
    toast.success(`Таймер сна: ${minutes} мин`)
  }, [])

  // Sync progress
  useEffect(() => {
    if (tracks.length === 0) return
    const totalProgress =
      (currentTrack + (duration > 0 ? currentTime / duration : 0)) / tracks.length
    onProgressRef.current(totalProgress, {
      audioTrack: currentTrack,
      audioTime: currentTime,
    })
  }, [currentTrack, currentTime, duration, tracks.length])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [])

  const prevTrack = useCallback(() => {
    setCurrentTrack((prev) => Math.max(0, prev - 1))
  }, [])

  const nextTrack = useCallback(() => {
    setCurrentTrack((prev) => Math.min(tracks.length - 1, prev + 1))
  }, [tracks.length])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if (e.key === 'ArrowLeft') prevTrack()
      else if (e.key === 'ArrowRight') nextTrack()
      else if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prevTrack, nextTrack, togglePlay])

  // TOC navigation: jump to a specific track by index
  useEffect(() => {
    const onGotoTrack = (e: Event) => {
      const idx = (e as CustomEvent<number>).detail
      if (typeof idx === 'number') {
        setCurrentTrack(Math.max(0, Math.min(idx, tracks.length - 1)))
      }
    }
    window.addEventListener('audio-goto-track', onGotoTrack)
    return () => window.removeEventListener('audio-goto-track', onGotoTrack)
  }, [tracks.length])

  const seek = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    setCurrentTime(time)
  }, [])

  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v)
    setMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => !m)
  }, [])

  const cyclePlaybackRate = useCallback(() => {
    const rates = [1, 1.25, 1.5, 1.75, 2, 0.75]
    setPlaybackRate((prev) => {
      const idx = rates.indexOf(prev)
      return rates[(idx + 1) % rates.length]
    })
  }, [])

  const readerBg = {
    light: '#fafaf7',
    dark: '#1a1a1a',
    sepia: '#f4ecd8',
    contrast: '#000000',
  }[settings.theme]

  const readerFg = {
    light: '#1c1c1c',
    dark: '#d4d4d4',
    sepia: '#5b4636',
    contrast: '#ffffff',
  }[settings.theme]

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: readerBg }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Распаковка аудиокниги...</p>
        </div>
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: readerBg }}>
        <p className="text-muted-foreground">Не удалось извлечь аудиофайлы</p>
      </div>
    )
  }

  const currentTrackName = tracks[currentTrack]?.name || ''

  return (
    <div
      className="relative flex flex-col items-center overflow-y-auto"
      style={{
        background: readerBg,
        color: readerFg,
        height: 'calc(100vh - 6.5rem)',
      }}
    >
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-12">
        {/* Cover / Icon */}
        <div
          className="flex h-40 w-40 items-center justify-center rounded-2xl shadow-lg"
          style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
        >
          <Headphones className="h-20 w-20" style={{ color: 'var(--primary)' }} />
        </div>

        {/* Track info */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Глава {currentTrack + 1} из {tracks.length}
          </p>
          <p className="mt-1 text-xs opacity-70 truncate max-w-md" title={currentTrackName}>
            {currentTrackName}
          </p>
        </div>

        {/* Seek bar */}
        <div className="w-full">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            step={1}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="w-full cursor-pointer"
            style={{ accentColor: 'var(--primary)' }}
            aria-label="Прогресс воспроизведения"
          />
          <div className="flex justify-between text-xs tabular-nums opacity-70 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={prevTrack}
            disabled={currentTrack === 0}
            className="h-12 w-12 rounded-full"
            aria-label="Предыдущая глава"
          >
            <SkipBack className="h-5 w-5" />
          </Button>

          <Button
            variant="default"
            size="icon"
            onClick={togglePlay}
            className="h-16 w-16 rounded-full"
            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 ml-0.5" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={nextTrack}
            disabled={currentTrack >= tracks.length - 1}
            className="h-12 w-12 rounded-full"
            aria-label="Следующая глава"
          >
            <SkipForward className="h-5 w-5" />
          </Button>
        </div>

        {/* Secondary controls */}
        <div className="flex items-center gap-4">
          {/* Volume */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className="h-8 w-8"
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-20 cursor-pointer"
              style={{ accentColor: 'var(--primary)' }}
              aria-label="Громкость"
            />
          </div>

          {/* Playback speed */}
          <Button
            variant="outline"
            size="sm"
            onClick={cyclePlaybackRate}
            className="tabular-nums"
            aria-label="Скорость воспроизведения"
          >
            {playbackRate}x
          </Button>

          {/* Sleep timer */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={sleepEndsAt ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                aria-label="Таймер сна"
                title="Таймер сна"
              >
                <Timer className="h-3.5 w-3.5" />
                {sleepEndsAt ? formatTime(sleepRemaining) : 'Сон'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Таймер сна</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SLEEP_TIMER_OPTIONS.map((minutes) => (
                <DropdownMenuItem
                  key={minutes}
                  onClick={() => setSleepTimer(minutes)}
                  className={sleepEndsAt !== null && minutes === 0 ? 'text-destructive' : ''}
                >
                  {minutes === 0 ? 'Выключить' : `${minutes} мин`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Active sleep timer banner */}
        {sleepEndsAt !== null && (
          <button
            onClick={() => setSleepTimer(0)}
            className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs opacity-80 hover:opacity-100 transition-opacity"
            style={{ borderColor: 'color-mix(in srgb, var(--reader-fg) 20%, transparent)' }}
            title="Отключить таймер сна"
          >
            <Timer className="h-3 w-3" />
            <span className="tabular-nums">Остановится через {formatTime(sleepRemaining)}</span>
            <X className="h-3 w-3" />
          </button>
        )}

        {/* Track list */}
        {tracks.length > 1 && (
          <div className="w-full mt-4">
            <p className="text-xs uppercase tracking-wide opacity-50 mb-2">Главы</p>
            <div className="max-h-60 overflow-y-auto rounded-lg border" style={{ borderColor: 'color-mix(in srgb, var(--reader-fg) 10%, transparent)' }}>
              {tracks.map((track, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setCurrentTrack(i)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-primary/10"
                  style={{
                    background:
                      i === currentTrack
                        ? 'color-mix(in srgb, var(--primary) 15%, transparent)'
                        : 'transparent',
                  }}
                >
                  <span className="tabular-nums text-xs opacity-50 w-6">{i + 1}</span>
                  <span className="flex-1 truncate">{track.name}</span>
                  {i === currentTrack && isPlaying && (
                    <span className="text-xs" style={{ color: 'var(--primary)' }}>
                      ▶
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Side nav buttons */}
      <Button
        variant="ghost"
        size="icon"
        onClick={prevTrack}
        disabled={currentTrack === 0}
        className="fixed left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20"
        aria-label="Назад"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={nextTrack}
        disabled={currentTrack >= tracks.length - 1}
        className="fixed right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/5 hover:bg-black/10 disabled:opacity-20"
        aria-label="Вперёд"
      >
        <ChevronRight className="h-6 w-6" />
      </Button>
    </div>
  )
}
