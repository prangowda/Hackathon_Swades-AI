import { createReadStream, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@my-better-t-app/env/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/**
 * Per-session sequential queue.
 * Each session has its own Promise chain so chunks are transcribed in order
 * and no audio data crosses session boundaries.
 */
const sessionQueues = new Map<string, Promise<void>>();

/**
 * Transcribe a single WAV audio buffer using OpenAI Whisper.
 * Language is locked to English to prevent cross-language contamination.
 *
 * @param audioBuffer - Raw WAV audio as a Buffer
 * @param sessionId   - The session this chunk belongs to (for queue scoping)
 * @returns The transcribed text string
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  sessionId: string,
): Promise<string> {
  // Write buffer to a temp file (Whisper API requires a File/Stream)
  const tmpPath = join(tmpdir(), `chunk-${sessionId}-${Date.now()}.wav`);

  try {
    writeFileSync(tmpPath, audioBuffer);

    const stream = createReadStream(tmpPath);
    // Cast needed: openai SDK expects a specific File type but ReadStream works at runtime
    const fileStream = Object.assign(stream, { name: "audio.wav" }) as Parameters<
      typeof openai.audio.transcriptions.create
    >[0]["file"];

    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1",
      language: "en", // locked to English — no cross-language contamination
      response_format: "text",
    });

    return typeof response === "string" ? response.trim() : "";
  } finally {
    // Always clean up the temp file regardless of success/failure
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Enqueue a chunk transcription for a session.
 * Chunks within the same session are processed sequentially (in order).
 * Different sessions run in parallel but are completely isolated.
 *
 * @param sessionId   - Session identifier (used as queue key)
 * @param audioBuffer - WAV audio data for this chunk
 * @param onDone      - Callback invoked with the transcript when complete
 */
export function enqueueTranscription(
  sessionId: string,
  audioBuffer: Buffer,
  onDone: (text: string) => void,
): void {
  const prev = sessionQueues.get(sessionId) ?? Promise.resolve();

  const next = prev.then(async () => {
    try {
      const text = await transcribeAudio(audioBuffer, sessionId);
      onDone(text);
    } catch (err) {
      // Log but don't crash the queue — next chunk still processes
      console.error(`[transcribe] session=${sessionId}`, err);
      onDone("");
    }
  });

  sessionQueues.set(sessionId, next);
}

/**
 * Clears the queue for a session once it's ended.
 * Call this when a session is marked complete so GC can reclaim the Promise chain.
 */
export function clearSessionQueue(sessionId: string): void {
  sessionQueues.delete(sessionId);
}
