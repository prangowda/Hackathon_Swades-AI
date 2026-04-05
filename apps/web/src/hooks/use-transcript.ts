import { useCallback, useEffect, useRef, useState } from "react"

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000"

const POLL_INTERVAL_ACTIVE_MS = 2000
const POLL_INTERVAL_IDLE_MS = 5000

interface TranscriptSegment {
  index: number
  text: string | null
  ackedAt: string | null
}

interface TranscriptResponse {
  sessionId: string
  status: "active" | "ended"
  transcript: TranscriptSegment[]
  fullText: string
}

interface UseTranscriptResult {
  segments: TranscriptSegment[]
  fullText: string
  isLoading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Poll the transcript endpoint for a given session.
 * Returns ordered transcript segments scoped strictly to that session.
 * Polling stops automatically when the session ends.
 *
 * @param sessionId - The session to poll. Pass null to disable.
 * @param active    - Whether recording is active (controls poll frequency)
 */
export function useTranscript(
  sessionId: string | null,
  active: boolean,
): UseTranscriptResult {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [fullText, setFullText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const stoppedRef = useRef(false)

  const fetchTranscript = useCallback(async (sid: string) => {
    if (stoppedRef.current) return
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${sid}/transcript`)
      if (!res.ok) {
        setError(`Error fetching transcript: ${res.status}`)
        return
      }
      const data = (await res.json()) as TranscriptResponse
      setSegments(data.transcript)
      setFullText(data.fullText)
      setError(null)

      // Stop polling when session is ended (all chunks have been transcribed)
      if (data.status === "ended") {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
          stoppedRef.current = true
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    if (sessionIdRef.current) {
      setIsLoading(true)
      void fetchTranscript(sessionIdRef.current)
    }
  }, [fetchTranscript])

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    stoppedRef.current = false

    if (!sessionId) {
      // Reset state when session clears
      setSegments([])
      setFullText("")
      setError(null)
      setIsLoading(false)
      sessionIdRef.current = null
      return
    }

    sessionIdRef.current = sessionId

    // Immediate fetch
    setIsLoading(true)
    void fetchTranscript(sessionId)

    // Poll until session ends
    const interval = active ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS
    timerRef.current = setInterval(() => {
      if (sessionIdRef.current === sessionId) {
        void fetchTranscript(sessionId)
      }
    }, interval)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [sessionId, active, fetchTranscript])

  return { segments, fullText, isLoading, error, refresh }
}
