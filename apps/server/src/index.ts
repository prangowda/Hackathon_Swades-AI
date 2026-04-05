import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sessionRoutes } from "./routes/sessions";
import { serve } from "@hono/node-server";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

// Mount session routes — all transcription logic lives under /api/sessions
app.route("/api/sessions", sessionRoutes);

// Global not-found handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error("[server] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});


const port = Number(process.env.PORT) || 3000;

if (typeof Bun === "undefined") {
  console.log(`Server is running on port ${port}`);
  serve({
    fetch: app.fetch,
    port,
  });
}

export default app;
