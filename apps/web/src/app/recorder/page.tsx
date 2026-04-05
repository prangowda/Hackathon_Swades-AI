"use client"

import { useCallback, useRef, useState } from "react"
import { Download, Loader2, Mic, Pause, Play, Square, Trash2 } from "lucide-react"

import { Button } from "@my-better-t-app/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { LiveWaveform } from "@/components/ui/live-waveform"
import { useRecorder, type WavChunk } from "@/hooks/use-recorder"
import { useTranscript } from "@/hooks/use-transcript"

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

function UploadBadge({ status }: { status: WavChunk["uploadStatus"] }) {
  const map = {
    pending: { label: "queued", cls: "bg-muted text-muted-foreground" },
    uploading: { label: "uploading", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    done: { label: "acked", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    error: { label: "retry", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  }
  const { label, cls } = map[status]
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function ChunkRow({ chunk, index }: { chunk: WavChunk; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      el.currentTime = 0
      setPlaying(false)
    } else {
      el.play()
      setPlaying(true)
    }
  }

  const download = () => {
    const a = document.createElement("a")
    a.href = chunk.url
    a.download = `chunk-${index + 1}.wav`
    a.click()
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={chunk.url}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        #{index + 1}
      </span>
      <span className="text-xs tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className="text-[10px] text-muted-foreground">16kHz PCM</span>
      <UploadBadge status={chunk.uploadStatus} />
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle}>
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download}>
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  )
}

function TranscriptPanel({
  sessionId,
  isActive,
}: {
  sessionId: string | null
  isActive: boolean
}) {
  const { segments, fullText, isLoading } = useTranscript(sessionId, isActive)

  if (!sessionId) return null

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle>Live Transcript</CardTitle>
          {isLoading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <CardDescription>
          {isActive ? "Transcribing in real-time (English)" : "Session complete"}
          {sessionId && (
            <span className="ml-2 font-mono text-[10px] opacity-50">
              {sessionId.slice(0, 8)}…
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {isLoading ? "Waiting for first chunk…" : "No transcript yet"}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {segments.map((seg) => (
              <div
                key={seg.index}
                className="flex gap-2 rounded-sm border border-border/40 bg-muted/20 px-3 py-2"
              >
                <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                  [{seg.index + 1}]
                </span>
                <p className="text-sm leading-relaxed">{seg.text}</p>
              </div>
            ))}
            {fullText && segments.length > 1 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Full transcript
                </summary>
                <p className="mt-2 rounded border border-border/40 bg-muted/30 p-3 text-sm leading-relaxed">
                  {fullText}
                </p>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function RecorderPage() {
  const [deviceId] = useState<string | undefined>()
  const { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks, sessionId } =
    useRecorder({ chunkDuration: 5, deviceId })

  const isRecording = status === "recording"
  const isPaused = status === "paused"
  const isActive = isRecording || isPaused

  const handlePrimary = useCallback(() => {
    if (isActive) {
      stop()
    } else {
      start()
    }
  }, [isActive, stop, start])

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>16 kHz / 16-bit PCM WAV — chunked every 5 s · transcribed by Whisper (EN)</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Waveform */}
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={isPaused}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>

          {/* Timer */}
          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          {/* Session badge */}
          {sessionId && (
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              session: {sessionId.slice(0, 16)}…
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {/* Record / Stop */}
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handlePrimary}
              disabled={status === "requesting"}
            >
              {isActive ? (
                <>
                  <Square className="size-4" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="size-4" />
                  {status === "requesting" ? "Requesting..." : "Record"}
                </>
              )}
            </Button>

            {/* Pause / Resume */}
            {isActive && (
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={isPaused ? resume : pause}
              >
                {isPaused ? (
                  <>
                    <Play className="size-4" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-4" />
                    Pause
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Live Transcript */}
      <TranscriptPanel sessionId={sessionId} isActive={isActive} />

      {/* Chunks */}
      {chunks.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Chunks</CardTitle>
            <CardDescription>{chunks.length} recorded</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chunks.map((chunk, i) => (
              <ChunkRow key={chunk.id} chunk={chunk} index={i} />
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 gap-1.5 self-end text-destructive"
              onClick={clearChunks}
            >
              <Trash2 className="size-3" />
              Clear all
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
