import { Agent, fileSearchTool, run, webSearchTool } from '@openai/agents';
import { z } from 'zod';

const VECTOR_STORE_ID = 'vs_68e653c6dabc8191885ad47257dea492';
const WORKFLOW_ID = 'wf_692d8a21f0848190943a527860d0d75d0cf55f49b005a5dd';
const MODEL = 'gpt-5.5';

const classifyOutput = z.object({
  operating_procedure: z.enum(['q-and-a', 'fact-finding', 'needs-more-detail']),
});

const fileSearch = fileSearchTool([VECTOR_STORE_ID]);
const webSearch = webSearchTool({
  searchContextSize: 'medium',
  externalWebAccess: true,
  userLocation: {
    type: 'approximate',
  },
});

const queryRewrite = new Agent({
  name: 'Query rewrite',
  instructions: "Rewrite the user's question to be more specific and relevant to the knowledge base.",
  model: MODEL,
  modelSettings: {
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  },
});

const classify = new Agent({
  name: 'Classify',
  instructions: `Determine whether the question should use the file-search internal knowledge base process or the external web fact-finding process.

Return operating_procedure as exactly one of:
- q-and-a: Use this for internal kb, RAG, file search, project documents, or questions likely answered by the knowledge base.
- fact-finding: Use this for current, recent, external, news, policy, market, pricing, or web-based facts.
- needs-more-detail: Use this only when the user's request is too vague to route.

If the question specifies internal kb / RAG / file search, choose q-and-a.`,
  model: MODEL,
  outputType: classifyOutput,
  modelSettings: {
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  },
});

const internalQA = new Agent({
  name: 'Internal Q&A',
  instructions: `Role & Expertise You are a senior consultant and subject-matter expert in biochar, carbon markets, carbon credits, MRV, and certification methodologies. You are deeply familiar with industry standards, scientific fundamentals, project development, commercial structuring, and global biochar news and policy developments.

How you answer queries
First, check all available knowledge sources (RAG documents, file search, and web results if enabled).
Extract only what is relevant to the user's question.
Return a response that is:
Accurate and grounded in retrieved knowledge
Concise and structured, summary first
Supported by bullet points, figures, and key takeaways
Action-oriented where advice is requested

If information is missing or uncertain, acknowledge uncertainty and suggest what additional data is needed rather than guessing.`,
  model: MODEL,
  tools: [fileSearch],
  modelSettings: {
    reasoning: { effort: 'medium' },
    text: { verbosity: 'medium' },
  },
});

const externalFactFinding = new Agent({
  name: 'External fact finding',
  instructions: `You answer questions that require current or external facts.

Always use the web_search tool before answering. Do not rely on memory for current facts.
Search the live web, prefer recent and primary sources, and compare publication dates when recency matters.
Make the answer date-aware: when a user says "latest", "recent", "today", or asks about news/markets/policy, state the concrete date you checked and the dates of key sources or events.

Important: web_search is OpenAI hosted web search, not Google Search. Do not claim these are Google results or Google rankings.

Output a concise answer first, followed by summarized supporting evidence with clearly visible source URLs where available.`,
  model: MODEL,
  tools: [webSearch],
  modelSettings: {
    reasoning: { effort: 'medium' },
    text: { verbosity: 'medium' },
    toolChoice: 'web_search',
  },
});

const askForMoreDetail = new Agent({
  name: 'Agent',
  instructions: 'Ask the user to provide more detail so you can help them by either answering their question or running data analysis relevant to their query.',
  model: MODEL,
  modelSettings: {
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  },
});

function traceOptions() {
  return {
    traceMetadata: {
      __trace_source__: 'agent-builder-migration',
      workflow_id: WORKFLOW_ID,
    },
  };
}

function ensureText(output) {
  if (typeof output === 'string') {
    return output;
  }
  if (output == null) {
    return '';
  }
  return JSON.stringify(output);
}

export async function runWorkflow(question) {
  const input = String(question || '').trim();
  if (!input) {
    throw new Error('Question is required.');
  }

  const rewriteResult = await run(
    queryRewrite,
    `Original question: ${input}`,
    traceOptions()
  );
  const rewrittenQuestion = ensureText(rewriteResult.finalOutput) || input;

  const classifyResult = await run(
    classify,
    `Question: ${rewrittenQuestion}`,
    traceOptions()
  );
  const route = classifyResult.finalOutput?.operating_procedure || 'needs-more-detail';

  if (route === 'q-and-a') {
    const result = await run(internalQA, rewrittenQuestion, traceOptions());
    return {
      answer: ensureText(result.finalOutput),
      route,
      rewritten_question: rewrittenQuestion,
    };
  }

  if (route === 'fact-finding') {
    const result = await run(externalFactFinding, rewrittenQuestion, traceOptions());
    return {
      answer: ensureText(result.finalOutput),
      route,
      rewritten_question: rewrittenQuestion,
    };
  }

  const result = await run(askForMoreDetail, input, traceOptions());
  return {
    answer: ensureText(result.finalOutput),
    route: 'needs-more-detail',
    rewritten_question: rewrittenQuestion,
  };
}

export async function streamWorkflow(question, emit) {
  const input = String(question || '').trim();
  if (!input) {
    throw new Error('Question is required.');
  }

  emit({ type: 'status', message: 'Rewriting question...' });
  const rewriteResult = await run(
    queryRewrite,
    `Original question: ${input}`,
    traceOptions()
  );
  const rewrittenQuestion = ensureText(rewriteResult.finalOutput) || input;
  emit({
    type: 'rewrite',
    rewritten_question: rewrittenQuestion,
  });

  emit({ type: 'status', message: 'Choosing route...' });
  const classifyResult = await run(
    classify,
    `Question: ${rewrittenQuestion}`,
    traceOptions()
  );
  const route = classifyResult.finalOutput?.operating_procedure || 'needs-more-detail';
  emit({ type: 'route', route });

  let agentToRun = askForMoreDetail;
  let streamedInput = input;
  if (route === 'q-and-a') {
    emit({ type: 'status', message: 'Searching internal knowledge base...' });
    agentToRun = internalQA;
    streamedInput = rewrittenQuestion;
  } else if (route === 'fact-finding') {
    emit({ type: 'status', message: 'Searching the web...' });
    agentToRun = externalFactFinding;
    streamedInput = rewrittenQuestion;
  } else {
    emit({ type: 'status', message: 'Asking for more detail...' });
  }

  const result = await run(agentToRun, streamedInput, {
    ...traceOptions(),
    stream: true,
  });

  let answer = '';
  const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
  for await (const chunk of textStream) {
    const delta = chunk.toString();
    answer += delta;
    emit({ type: 'delta', delta });
  }

  await result.completed;
  emit({
    type: 'done',
    answer,
    route,
    rewritten_question: rewrittenQuestion,
  });
}
