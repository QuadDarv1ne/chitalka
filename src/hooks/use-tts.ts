'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface TTSState {
  speaking: boolean
  paused: boolean
  currentChunk: number
  totalChunks: number
  /** Char offset of the current chunk within the original spoken text. */
  currentChunkStart: number
}

/**
 * Text-to-speech hook using Web Speech API.
 * Splits text into ~200-char chunks at sentence boundaries.
 */
export function useTTS() {
  const [state, setState] = useState<TTSState>({
    speaking: false,
    paused: false,
    currentChunk: 0,
    totalChunks: 0,
    currentChunkStart: 0,
  })
  const chunksRef = useRef<string[]>([])
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([])
  const rateRef = useRef(1.0)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const cancelledRef = useRef(false)
  // Monotonic session id: browser cancel() delivers stale onend/onerror
  // callbacks asynchronously, and a boolean flag reset right after cancel()
  // can let the previous session's callbacks resume old chunks.
  const sessionRef = useRef(0)

  useEffect(() => {
    return () => {
      sessionRef.current++
      cancelledRef.current = true
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const splitIntoChunks = (text: string): { text: string; start: number }[] => {
    // Split by sentence boundaries, keep chunks <= 220 chars.
    // Each chunk records the char offset of its first non-whitespace char
    // in the original text, so callers can map it back to the source.
    const sentenceRegex = /[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g
    const chunks: { text: string; start: number }[] = []
    let current = ''
    let currentStart = 0
    let m: RegExpExecArray | null
    while ((m = sentenceRegex.exec(text)) !== null) {
      const trimmed = m[0].trim()
      if (!trimmed) continue
      const leading = m[0].length - m[0].trimStart().length
      const sentenceStart = m.index + leading
      if ((current + ' ' + trimmed).length > 220 && current) {
        chunks.push({ text: current, start: currentStart })
        current = trimmed
        currentStart = sentenceStart
      } else {
        if (!current) currentStart = sentenceStart
        current = current ? `${current} ${trimmed}` : trimmed
      }
    }
    if (current) chunks.push({ text: current, start: currentStart })
    return chunks
  }

  const speak = useCallback((text: string, opts?: { rate?: number; voice?: SpeechSynthesisVoice | null }) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    // Invalidate the previous session BEFORE cancel() so its pending
    // callbacks (delivered asynchronously by the browser) are discarded.
    const sessionId = ++sessionRef.current
    window.speechSynthesis.cancel()
    cancelledRef.current = false
    rateRef.current = opts?.rate ?? 1.0
    voiceRef.current = opts?.voice ?? null

    const chunks = splitIntoChunks(text)
    const starts = chunks.map((c) => c.start)
    chunksRef.current = chunks.map((c) => c.text)
    if (chunks.length === 0) return

    setState({
      speaking: true,
      paused: false,
      currentChunk: 0,
      totalChunks: chunks.length,
      currentChunkStart: starts[0] ?? 0,
    })

    const utterances: SpeechSynthesisUtterance[] = chunks.map((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.text)
      u.rate = rateRef.current
      u.lang = 'ru-RU'
      if (voiceRef.current) u.voice = voiceRef.current
      u.onstart = () => {
        if (sessionRef.current !== sessionId || cancelledRef.current) return
        setState((s) => ({
          ...s,
          currentChunk: i,
          speaking: true,
          paused: false,
          currentChunkStart: starts[i] ?? 0,
        }))
      }
      u.onend = () => {
        if (sessionRef.current !== sessionId || cancelledRef.current) return
        const next = i + 1
        if (next < chunks.length) {
          // Chrome quirk: speak() called synchronously from an onend
          // callback can be swallowed — defer to the next task.
          setTimeout(() => {
            if (sessionRef.current !== sessionId || cancelledRef.current) return
            window.speechSynthesis.speak(utterances[next])
          }, 0)
        } else {
          setState({
            speaking: false,
            paused: false,
            currentChunk: 0,
            totalChunks: 0,
            currentChunkStart: 0,
          })
        }
      }
      u.onerror = () => {
        if (sessionRef.current !== sessionId || cancelledRef.current) return
        setState({
          speaking: false,
          paused: false,
          currentChunk: 0,
          totalChunks: 0,
          currentChunkStart: 0,
        })
      }
      return u
    })
    utterancesRef.current = utterances
    if (chunks.length > 0) window.speechSynthesis.speak(utterances[0])
  }, [])

  const pause = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause()
      setState((s) => ({ ...s, paused: true }))
    }
  }, [])

  const resume = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.resume()
      setState((s) => ({ ...s, paused: false }))
    }
  }, [])

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      cancelledRef.current = true
      sessionRef.current++
      window.speechSynthesis.cancel()
      setState({
        speaking: false,
        paused: false,
        currentChunk: 0,
        totalChunks: 0,
        currentChunkStart: 0,
      })
    }
  }, [])

  return { ...state, speak, pause, resume, stop }
}
