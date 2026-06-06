import http from 'node:http';

import { streamWorkflow } from './lib/gc-agent.js';

const port = Number(process.env.PORT || 8000);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });
  res.end(body);
}

function startEventStream(res) {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  return (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/run-agent') {
    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 500, { error: 'Missing OPENAI_API_KEY environment variable' });
      return;
    }

    try {
      const body = await readJson(req);
      if (!body.question || typeof body.question !== 'string') {
        sendJson(res, 400, { error: 'Missing required field: question' });
        return;
      }

      const sendEvent = startEventStream(res);
      await streamWorkflow(body.question, sendEvent);
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: error?.name || 'AgentError',
          message: error?.message || 'Failed to run agent',
        });
        return;
      }

      res.write(`data: ${JSON.stringify({
        error: error?.name || 'AgentError',
        message: error?.message || 'Failed to run agent',
        type: 'error',
      })}\n\n`);
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local agent API listening on http://127.0.0.1:${port}`);
});
