import { FormEvent, ReactNode, useMemo, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  route?: string;
  status?: string;
};

type StreamEvent = {
  type?: "status" | "rewrite" | "route" | "delta" | "done" | "error";
  answer?: string;
  delta?: string;
  route?: string;
  error?: string;
  message?: string;
  rewritten_question?: string;
};

const starterQuestions = [
  "What does the internal knowledge base say about biochar MRV?",
  "What are the latest biochar carbon market policy updates?",
  "Compare Puro and Verra requirements for biochar projects.",
];

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const cleanText = text.replace(/filecite[^]+/g, "").trimEnd();
  const pattern = /(\*\*([^*]+)\*\*)|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanText)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(cleanText.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(
        <strong className="font-semibold text-[#17211b]" key={`${match.index}-bold`}>
          {match[2]}
        </strong>
      );
    } else {
      const label = match[3] || match[5];
      const href = match[4] || match[5];
      nodes.push(
        <a
          className="font-medium text-[#1f6f52] underline decoration-[#8fb69f] underline-offset-2"
          href={href}
          key={`${match.index}-link`}
          rel="noreferrer"
          target="_blank"
        >
          {label}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < cleanText.length) {
    nodes.push(cleanText.slice(lastIndex));
  }

  return nodes;
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    elements.push(
      <ul className="my-3 list-disc space-y-1 pl-5" key={`list-${elements.length}`}>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed === "---") {
      flushList();
      elements.push(
        <hr className="my-5 border-[#d8ded5]" key={`hr-${index}`} />
      );
      return;
    }

    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }

    flushList();

    if (trimmed.startsWith("### ")) {
      elements.push(
        <h4 className="mb-2 mt-5 text-base font-semibold text-[#17211b]" key={index}>
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
      return;
    }

    if (trimmed.startsWith("## ")) {
      elements.push(
        <h3 className="mb-2 mt-6 text-lg font-semibold text-[#17211b]" key={index}>
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith("# ")) {
      elements.push(
        <h2 className="mb-3 mt-6 text-xl font-semibold text-[#17211b]" key={index}>
          {renderInlineMarkdown(trimmed.slice(2))}
        </h2>
      );
      return;
    }

    elements.push(
      <p className="my-3" key={index}>
        {renderInlineMarkdown(trimmed)}
      </p>
    );
  });

  flushList();

  return <div className="text-sm leading-6">{elements}</div>;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const canSubmit = useMemo(
    () => question.trim().length > 0 && !isRunning,
    [isRunning, question]
  );

  async function sendQuestion(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || isRunning) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsRunning(true);

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "Starting...",
      },
    ]);

    const updateAssistant = (update: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, ...update } : message
        )
      );
    };

    const appendAssistantContent = (delta: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: `${message.content}${delta}`,
                status: undefined,
              }
            : message
        )
      );
    };

    try {
      const response = await fetch("/api/run-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as StreamEvent;
        throw new Error(payload.message || payload.error || "Failed to run agent.");
      }

      if (!response.body) {
        throw new Error("Streaming response was empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "status" && event.message) {
          updateAssistant({ status: event.message });
        }
        if (event.type === "route" && event.route) {
          updateAssistant({ route: event.route });
        }
        if (event.type === "delta" && event.delta) {
          appendAssistantContent(event.delta);
        }
        if (event.type === "done") {
          updateAssistant({
            content: event.answer,
            route: event.route,
            status: undefined,
          });
        }
        if (event.type === "error") {
          throw new Error(event.message || event.error || "Failed to run agent.");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventText of events) {
          const dataLine = eventText
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          const event = JSON.parse(dataLine.slice(6)) as StreamEvent;
          handleEvent(event);
        }
      }

      const finalText = buffer + decoder.decode();
      if (finalText.trim()) {
        const dataLine = finalText
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine) {
          handleEvent(JSON.parse(dataLine.slice(6)) as StreamEvent);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      updateAssistant({
        content: message,
        route: "error",
        status: undefined,
      });
    } finally {
      setIsRunning(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(question);
  }

  return (
    <main className="min-h-screen bg-[#f7f7f3] text-[#1f2723]">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="flex items-center justify-between border-b border-[#d8ded5] pb-4">
          <div>
            <h1 className="text-xl font-semibold">GC Agent</h1>
            <p className="mt-1 text-sm text-[#637167]">
              Agents SDK workflow for biochar, MRV, and carbon markets.
            </p>
          </div>
          <div className="rounded-full border border-[#bfd1c4] px-3 py-1 text-xs font-medium text-[#2d6a4f]">
            SDK backend
          </div>
        </header>

        <section className="flex flex-1 flex-col gap-4 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center">
              <div className="max-w-3xl">
                <h2 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                  Ask your carbon markets knowledge agent.
                </h2>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {starterQuestions.map((starter) => (
                    <button
                      className="min-h-24 rounded-lg border border-[#d8ded5] bg-white p-4 text-left text-sm text-[#26312b] shadow-sm transition hover:border-[#95b39f] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isRunning}
                      key={starter}
                      onClick={() => void sendQuestion(starter)}
                      type="button"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
              {messages.map((message) => (
                <article
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[82%] rounded-lg bg-[#2d6a4f] px-4 py-3 text-white"
                      : "mr-auto max-w-[88%] rounded-lg border border-[#d8ded5] bg-white px-4 py-3 shadow-sm"
                  }
                  key={message.id}
                >
                  {message.route ? (
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6e7c72]">
                      {message.route}
                    </div>
                  ) : null}
                  {message.status ? (
                    <div className="mb-2 text-xs font-medium text-[#637167]">
                      {message.status}
                    </div>
                  ) : null}
                  {message.role === "assistant" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <form
          className="flex gap-3 border-t border-[#d8ded5] pt-4"
          onSubmit={handleSubmit}
        >
          <textarea
            className="min-h-14 flex-1 resize-none rounded-lg border border-[#c9d4cc] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[#8a968d] focus:border-[#2d6a4f] focus:ring-2 focus:ring-[#2d6a4f]/15"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSubmit) void sendQuestion(question);
              }
            }}
            placeholder="Ask about biochar MRV, standards, credits, or market developments..."
            rows={2}
            value={question}
          />
          <button
            className="h-14 rounded-lg bg-[#2d6a4f] px-5 text-sm font-semibold text-white transition hover:bg-[#255a43] disabled:cursor-not-allowed disabled:bg-[#9aac9f]"
            disabled={!canSubmit}
            type="submit"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
