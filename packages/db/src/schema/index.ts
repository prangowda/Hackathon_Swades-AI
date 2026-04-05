import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  chunkIndex: integer("chunk_index").notNull(),
  transcriptText: text("transcript_text"),
  ackedAt: timestamp("acked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
