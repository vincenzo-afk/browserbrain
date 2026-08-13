// BrowserBrain runtime contract: keep heavy local inference isolated from the editorial UI thread.
// The worker owns Transformers.js, model download, ONNX warmup, and one-request-at-a-time generation.

import { env, pipeline } from "@huggingface/transformers";

type Candidate = { id: string; task: "text2text-generation" | "text-generation"; dtype: string; label: string; modelFileName?: string };
type WorkerRequest = { type: "load" | "generate" | "stop"; requestId: number; messages?: Array<{ role: string; content: string }>; maxTokens?: number; temperature?: number };

const candidates: Candidate[] = [
  { id: "Xenova/flan-t5-small", task: "text2text-generation", dtype: "int8", label: "FLAN-T5 small · CPU" },
  { id: "Xenova/flan-t5-small", task: "text2text-generation", dtype: "fp32", label: "FLAN-T5 small · rescue" },
];

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = "https://huggingface.co/";
env.remotePathTemplate = "{model}/resolve/{revision}/";
env.useBrowserCache = true;

const worker = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let generator: any = null;
let activeTask: Candidate["task"] = "text-generation";
let activeRequest = 0;

const post = (message: unknown) => worker.postMessage(message);

async function loadModel(requestId: number) {
  activeRequest = requestId;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      post({ type: "progress", requestId, progress: 4, label: `Preparing ${candidate.label}…` });
      const heartbeat = setInterval(() => post({ type: "progress", requestId, progress: 94, label: "Compiling the local decoder…" }), 8_000);
      try {
        generator = await pipeline(candidate.task, candidate.id, {
        device: "wasm",
        dtype: candidate.dtype as any,
        ...(candidate.modelFileName ? { model_file_name: candidate.modelFileName } : {}),
        progress_callback: (info: any) => {
          const value = typeof info?.progress === "number" ? Math.round(info.progress) : 0;
          const file = info?.file ? String(info.file).split("/").pop() : "";
          post({ type: "progress", requestId, progress: Math.max(4, Math.min(92, value)), label: file ? `Downloading ${file}` : `Loading ${candidate.label}…` });
        },
        } as any);
      } finally {
        clearInterval(heartbeat);
      }
      post({ type: "progress", requestId, progress: 94, label: "Warming up the private decoder…" });
      const warmup = candidate.task === "text2text-generation"
        ? "Answer in one word: What is the capital of France?"
        : "User: Reply with the single word OK.\nAssistant:";
      await generator(warmup, { max_new_tokens: 4, do_sample: false, return_full_text: false });
      activeTask = candidate.task;
      post({ type: "ready", requestId, label: candidate.label });
      return;
    } catch (error) {
      lastError = error;
      generator = null;
      activeTask = "text-generation";
      post({ type: "progress", requestId, progress: 4, label: `${candidate.label} was unavailable; trying the rescue path…` });
    }
  }
  post({ type: "error", requestId, message: lastError instanceof Error ? lastError.message : "No CPU-compatible browser model could initialize." });
}

async function generate(request: WorkerRequest) {
  if (!generator) throw new Error("The CPU model is not ready yet.");
  const messages = request.messages || [];
  const prompt = messages.map((message) => `${message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User"}: ${String(message.content || "")}`).join("\n") + "\nAssistant:";
  const taskPrompt = activeTask === "text2text-generation"
    ? `${messages.find((message) => message.role === "system")?.content || "Answer clearly and concisely."}\n\n${prompt}`
    : prompt;
  const output: any = await generator(taskPrompt, {
    max_new_tokens: request.maxTokens || 512,
    temperature: request.temperature ?? 0.28,
    top_p: 0.9,
    repetition_penalty: 1.08,
    do_sample: (request.temperature ?? 0.28) > 0.1,
    return_full_text: false,
  });
  const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
  const raw = Array.isArray(generated) ? String(generated.at(-1)?.content || "") : String(generated || "");
  post({ type: "generated", requestId: request.requestId, text: raw.replace(/<\|im_end\|>[\s\S]*$/, "").trim() });
}

worker.onmessage = (event) => {
  const request = event.data;
  if (request.type === "load") void loadModel(request.requestId);
  if (request.type === "generate") void generate(request).catch((error) => post({ type: "generation-error", requestId: request.requestId, message: error instanceof Error ? error.message : "Local generation failed." }));
  if (request.type === "stop") activeRequest = -1;
};
