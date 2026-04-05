import { chunks, db, sessions } from "@my-better-t-app/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { clearSessionQueue, enqueueTranscription } from "../transcribe";

export const sessionRoutes = new Hono();

// ─── POST /api/sessions ──────────────────────────────────────────────────────
// Create a new isolated session and return its ID
sessionRoutes.post("/", async (c) => {
  const sessionId = crypto.randomUUID();

  await db.insert(sessions).values({
    id: sessionId,
    status: "active",
  });

  return c.json({ sessionId }, 201);
});

// ─── POST /api/sessions/:sessionId/chunks ────────────────────────────────────
// Accept a WAV audio chunk, persist ack to DB, enqueue for transcription
sessionRoutes.post("/:sessionId/chunks", async (c) => {
  const { sessionId } = c.req.param();

  // Validate session exists and is active
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  if (session.status !== "active") {
    return c.json({ error: "Session is not active" }, 409);
  }

  // Parse form data — chunk is uploaded as a binary file field + index
  const body = await c.req.parseBody();
  const chunkIndexRaw = body["chunkIndex"];
  const audioFile = body["audio"];

  if (typeof chunkIndexRaw !== "string" || !audioFile || typeof audioFile === "string") {
    return c.json({ error: "Missing audio or chunkIndex" }, 400);
  }

  const chunkIndex = parseInt(chunkIndexRaw, 10);
  if (Number.isNaN(chunkIndex) || chunkIndex < 0) {
    return c.json({ error: "Invalid chunkIndex" }, 400);
  }

  // Convert the uploaded File to a Buffer
  const arrayBuffer = await audioFile.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  // Generate a chunk ID
  const chunkId = crypto.randomUUID();

  // Write ack to DB immediately (chunk received) — transcript filled later
  await db.insert(chunks).values({
    id: chunkId,
    sessionId,
    chunkIndex,
    transcriptText: null,
    ackedAt: new Date(),
  });

  // Enqueue transcription — sequential within this session, isolated from others
  enqueueTranscription(sessionId, audioBuffer, async (text) => {
    await db
      .update(chunks)
      .set({ transcriptText: text })
      .where(eq(chunks.id, chunkId));
  });

  return c.json({ chunkId, queued: true }, 200);
});

// ─── GET /api/sessions/:sessionId/transcript ────────────────────────────────
// Return ordered transcript segments for this session only
sessionRoutes.get("/:sessionId/transcript", async (c) => {
  const { sessionId } = c.req.param();

  // Validate session exists
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Fetch only chunks belonging to this session, in order
  const sessionChunks = await db
    .select({
      chunkIndex: chunks.chunkIndex,
      transcriptText: chunks.transcriptText,
      ackedAt: chunks.ackedAt,
    })
    .from(chunks)
    .where(eq(chunks.sessionId, sessionId))
    .orderBy(asc(chunks.chunkIndex));

  const transcript = sessionChunks
    .filter((ch) => ch.transcriptText !== null && ch.transcriptText.trim() !== "")
    .map((ch) => ({
      index: ch.chunkIndex,
      text: ch.transcriptText,
      ackedAt: ch.ackedAt,
    }));

  return c.json({
    sessionId,
    status: session.status,
    transcript,
    fullText: transcript.map((t) => t.text).join(" "),
  });
});

// ─── POST /api/sessions/:sessionId/end ──────────────────────────────────────
// Mark session complete, clear its in-memory queue
sessionRoutes.post("/:sessionId/end", async (c) => {
  const { sessionId } = c.req.param();

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  await db
    .update(sessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  // Clear the in-memory queue so the Promise chain can be GC'd
  clearSessionQueue(sessionId);

  return c.json({ sessionId, status: "ended" });
});
