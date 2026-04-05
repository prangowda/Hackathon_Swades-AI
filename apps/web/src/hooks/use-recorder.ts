import { useCallback, useEffect, useRef, useState } from "react"

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000"

export interface WavChunk {
  id: string
  blob: Blob
  url: string
  duration: number
  timestamp: number
  uploadStatus: "pending" | "uploading" | "done" | "error"
}

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused"

interface UseRecorderOptions {
  chunkDuration?: number
  deviceId?: string
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.round(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, input.length - 1)
    const frac = srcIndex - low
    output[i] = (input[low] ?? 0) * (1 - frac) + (input[high] ?? 0) * frac
  }
  return output
}

/**
 * Upload a WAV blob to the server for a specific session.
 * Fully isolated — uses sessionId to scope the upload.
 */
async function uploadChunk(
  sessionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<void> {
  const form = new FormData()
  form.append("audio", blob, "chunk.wav")
  form.append("chunkIndex", String(chunkIndex))

  const res = await fetch(`${SERVER_URL}/api/sessions/${sessionId}/chunks`, {
    method: "POST",
    body: form,
  })

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`)
  }
}

export function useRecorder(options: UseRecorderOptions = {}) {
  const { chunkDuration = 5, deviceId } = options

  const [status, setStatus] = useState<RecorderStatus>("idle")
  const [chunks, setChunks] = useState<WavChunk[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const sampleCountRef = useRef(0)
  const chunkThreshold = SAMPLE_RATE * chunkDuration
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const pausedElapsedRef = useRef(0)
  const statusRef = useRef<RecorderStatus>("idle")
  const sessionIdRef = useRef<string | null>(null)
  const chunkIndexRef = useRef(0)

  statusRef.current = status
  sessionIdRef.current = sessionId

  const emitChunk = useCallback(
    (samples: Float32Array[]) => {
      if (samples.length === 0) return

      const totalLen = samples.reduce((n, b) => n + b.length, 0)
      const merged = new Float32Array(totalLen)
      let offset = 0
      for (const buf of samples) {
        merged.set(buf, offset)
        offset += buf.length
      }

      const blob = encodeWav(merged, SAMPLE_RATE)
      const url = URL.createObjectURL(blob)
      const chunkId = crypto.randomUUID()
      const chunkIndex = chunkIndexRef.current++
      const sid = sessionIdRef.current

      const chunk: WavChunk = {
        id: chunkId,
        blob,
        url,
        duration: merged.length / SAMPLE_RATE,
        timestamp: Date.now(),
        uploadStatus: "pending",
      }
      setChunks((prev) => [...prev, chunk])

      // Upload to server — only if we have an active session
      if (sid) {
        setChunks((prev) =>
          prev.map((c) => (c.id === chunkId ? { ...c, uploadStatus: "uploading" } : c)),
        )
        uploadChunk(sid, chunkIndex, blob)
          .then(() => {
            setChunks((prev) =>
              prev.map((c) => (c.id === chunkId ? { ...c, uploadStatus: "done" } : c)),
            )
          })
          .catch(() => {
            setChunks((prev) =>
              prev.map((c) => (c.id === chunkId ? { ...c, uploadStatus: "error" } : c)),
            )
          })
      }
    },
    [],
  )

  const flushChunk = useCallback(() => {
    const current = samplesRef.current
    samplesRef.current = []
    sampleCountRef.current = 0
    emitChunk(current)
  }, [emitChunk])

  const start = useCallback(async () => {
    if (statusRef.current === "recording") return

    setStatus("requesting")
    try {
      // Create a new isolated session on the server
      const sessionRes = await fetch(`${SERVER_URL}/api/sessions`, {
        method: "POST",
      })
      if (!sessionRes.ok) throw new Error("Failed to create session")
      const { sessionId: newSessionId } = (await sessionRes.json()) as { sessionId: string }

      setSessionId(newSessionId)
      chunkIndexRef.current = 0

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      })

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(mediaStream)
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      const nativeSampleRate = audioCtx.sampleRate

      processor.onaudioprocess = (e) => {
        if (statusRef.current !== "recording") return

        const input = e.inputBuffer.getChannelData(0)
        const resampled = resample(new Float32Array(input), nativeSampleRate, SAMPLE_RATE)

        samplesRef.current.push(resampled)
        sampleCountRef.current += resampled.length

        if (sampleCountRef.current >= chunkThreshold) {
          const collected = samplesRef.current
          samplesRef.current = []
          sampleCountRef.current = 0
          emitChunk(collected)
        }
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      streamRef.current = mediaStream
      audioCtxRef.current = audioCtx
      processorRef.current = processor
      setStream(mediaStream)

      samplesRef.current = []
      sampleCountRef.current = 0
      pausedElapsedRef.current = 0
      startTimeRef.current = Date.now()
      setElapsed(0)
      setChunks([])
      setStatus("recording")

      timerRef.current = setInterval(() => {
        if (statusRef.current === "recording") {
          setElapsed(
            pausedElapsedRef.current + (Date.now() - startTimeRef.current) / 1000,
          )
        }
      }, 100)
    } catch {
      setStatus("idle")
      setSessionId(null)
    }
  }, [deviceId, chunkThreshold, emitChunk])

  const stop = useCallback(async () => {
    flushChunk()

    processorRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (audioCtxRef.current?.state !== "closed") {
      audioCtxRef.current?.close()
    }
    if (timerRef.current) clearInterval(timerRef.current)

    processorRef.current = null
    audioCtxRef.current = null
    streamRef.current = null
    setStream(null)
    setStatus("idle")

    // End the session on the server
    const sid = sessionIdRef.current
    if (sid) {
      try {
        await fetch(`${SERVER_URL}/api/sessions/${sid}/end`, { method: "POST" })
      } catch {
        // Non-critical — transcript already saved to DB
      }
      // Keep sessionId for transcript polling until a new recording starts
    }
  }, [flushChunk])

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return
    pausedElapsedRef.current += (Date.now() - startTimeRef.current) / 1000
    setStatus("paused")
  }, [])

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return
    startTimeRef.current = Date.now()
    setStatus("recording")
  }, [])

  const clearChunks = useCallback(() => {
    for (const c of chunks) URL.revokeObjectURL(c.url)
    setChunks([])
  }, [chunks])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (audioCtxRef.current?.state !== "closed") {
        audioCtxRef.current?.close()
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks, sessionId }
}
