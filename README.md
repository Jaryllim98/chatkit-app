# GC Agents SDK app

Vite + React UI that talks to a Vercel serverless endpoint running an OpenAI
Agents SDK workflow. This app no longer depends on an Agent Builder-hosted
workflow ID at runtime.

## Quick start

```bash
npm install           # installs root serverless dependencies
npm run dev           # runs the Vite frontend on :3000
```

In a second terminal, run the local API:

```bash
export OPENAI_API_KEY="sk-proj-..."
npm run api:dev
```

The Vite dev server proxies `/api/*` to `127.0.0.1:8000`.

For Vercel-style local API testing, you can also use the Vercel CLI:

```bash
vercel dev
```

## Required environment

- `OPENAI_API_KEY`

Set this in Vercel Project Settings and in your local shell before running.
The API key must belong to the OpenAI project that can access the vector store
used by the migrated file-search tool.

## Customize

- UI: `frontend/src/App.tsx`
- Agent workflow: `api/lib/gc-agent.js`
- API endpoint: `api/run-agent.js`
