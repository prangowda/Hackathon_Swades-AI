# Reliable Transcription Pipeline (Swades AI)

A robust, production-ready audio transcription pipeline built for reliability and high availability. It ensures recorded audio data stays accurate and is processed sequentially using OpenAI's Whisper model, with a focus on session isolation and fault tolerance.

## Core Functions

- **Session-Based Isolation**: Each recording session is assigned a unique UUID to prevent data leakage between different conversations.
- **Audio Chunking & OPFS**: Audio is split into small chunks and buffered in the browser's **Origin Private File System (OPFS)**, ensuring zero data loss if the browser closes or the network drops.
- **Sequential Transcription**: Chunks are uploaded to the Hono backend and enqueued for transcription. The system ensures each chunk is processed by OpenAI Whisper in the correct order within its specific session.
- **Real-Time Polling**: The frontend provides real-time transcript updates by polling the server for newly processed segments.
- **Database Persistence**: Every chunk acknowledgment and its corresponding transcript is persisted using **Drizzle ORM** and **PostgreSQL**.

## Architecture Flow

```mermaid
sequenceDiagram
    participant Browser
    participant OPFS
    participant Hono (Node/Bun)
    participant OpenAI (Whisper)
    participant DB (PostgreSQL)

    Browser->>OPFS: Buffer audio chunk
    Browser->>Hono: POST /api/sessions/:id/chunks
    Hono->>DB: Ack chunk received
    Hono->>OpenAI: Enqueue for transcription
    OpenAI->>Hono: Transcript text
    Hono->>DB: Update chunk with transcript
    Browser->>Hono: GET /api/sessions/:id/transcript (polling)
    Hono->>Browser: Send latest transcript segment
```

## Tech Stack

- **Frontend**: [Next.js](https://nextjs.org/) (App Router, TailwindCSS, shadcn/ui)
- **Backend API**: [Hono](https://hono.dev/) (Cross-runtime: Bun/Node.js compatible)
- **Runtime**: Native support for both **Bun** and **Node.js** (via `tsx`)
- **Database**: [Drizzle ORM](https://orm.drizzle.team/) + **PostgreSQL**
- **Transcription**: [OpenAI Whisper](https://openai.com/research/whisper)
- **Repo Tooling**: [Turborepo](https://turbo.build/repo) (Monorepo build system)

## Getting Started

### 1. Prerequisites
- Node.js (v18+) or Bun
- PostgreSQL (Local or Docker)

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables

Create `.env` files in the respective directories:

**Server (`apps/server/.env`):**
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/db
CORS_ORIGIN=http://localhost:3001
OPENAI_API_KEY=your_sk_key
```

**Web (`apps/web/.env`):**
```env
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

### 4. Database Setup
Push the schema to your database:
```bash
npm run db:push
```

### 5. Running in Development
```bash
npm run dev
```
- **Web App**: `http://localhost:3001`
- **API Server**: `http://localhost:3000`

## Project Structure

```text
├── apps/
│   ├── web/         # Next.js Frontend — Recording, OPFS, & Polling
│   └── server/      # Hono Backend — Transcription Queue & API
├── packages/
│   ├── ui/          # Shared shadcn/ui components
│   ├── db/          # Drizzle ORM schema & Postgres client
│   ├── env/         # Type-safe environment variable management
│   └── config/      # Shared TSConfig & Linting
```

## Available Scripts

- `npm run dev` — Start all workspaces (web + server)
- `npm run build` — Build all applications
- `npm run db:push` — Push schema directly to the database
- `npm run db:studio` — Visual GUI for your database (Drizzle Studio)
- `npm run check-types` — Run TypeScript type checking on all packages

