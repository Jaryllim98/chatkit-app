import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CHATKIT_BASE = 'https://api.openai.com';
const SESSION_COOKIE_NAME = 'chatkit_session_id';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method === 'POST' && req.url === '/api/create-session') {
    return createSession(req, res);
  }

  return res.status(404).json({ error: 'Not found' });
}

async function createSession(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return respond(res, { error: 'Missing OPENAI_API_KEY environment variable' }, 500);
  }

  const body = req.body || {};
  const workflowId = resolveWorkflowId(body);
  if (!workflowId) {
    return respond(res, { error: 'Missing workflow id' }, 400);
  }

  const [userId, cookieValue] = resolveUser(req.cookies);
  const apiBase = process.env.CHATKIT_API_BASE || process.env.VITE_CHATKIT_API_BASE || DEFAULT_CHATKIT_BASE;

  try {
    const response = await fetch(`${apiBase}/v1/chatkit/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'chatkit_beta=v1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow: { id: workflowId },
        user: userId,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload?.error || response.statusText || 'Failed to create session';
      return respond(res, { error: message }, response.status, cookieValue);
    }

    const clientSecret = payload?.client_secret;
    const expiresAfter = payload?.expires_after;

    if (!clientSecret) {
      return respond(res, { error: 'Missing client secret in response' }, 502, cookieValue);
    }

    return respond(
      res,
      { client_secret: clientSecret, expires_after: expiresAfter },
      200,
      cookieValue
    );
  } catch (error) {
    return respond(
      res,
      { error: `Failed to reach ChatKit API: ${error.message}` },
      502,
      cookieValue
    );
  }
}

function respond(res, payload, statusCode, cookieValue = null) {
  if (cookieValue) {
    const maxAge = SESSION_COOKIE_MAX_AGE_SECONDS;
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${cookieValue}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return res.status(statusCode).json(payload);
}

function resolveWorkflowId(body) {
  let workflowId = body?.workflow?.id || body?.workflowId;
  const envWorkflow = process.env.CHATKIT_WORKFLOW_ID || process.env.VITE_CHATKIT_WORKFLOW_ID;
  
  if (!workflowId && envWorkflow) {
    workflowId = envWorkflow;
  }
  
  return workflowId && typeof workflowId === 'string' ? workflowId.trim() : null;
}

function resolveUser(cookies = {}) {
  const existing = cookies[SESSION_COOKIE_NAME];
  if (existing) {
    return [existing, null];
  }
  const userId = uuidv4();
  return [userId, userId];
}
