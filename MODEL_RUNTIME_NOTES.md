# Browser model runtime notes

## Findings

- WebLLM exposes `CreateMLCEngine(model, { initProgressCallback })`; the model download is asynchronous and the first run can be lengthy.
- WebLLM streaming uses `engine.chat.completions.create({ messages, stream: true })` and yields `chunk.choices[0]?.delta.content`.
- Transformers.js runs text generation through ONNX Runtime. Browser WASM is the broadest fallback; WebGPU can be selected explicitly where supported.
- Transformers.js browser models should use quantized weights where available to reduce bandwidth and memory pressure.
- Remote model loading is configured through `env.allowRemoteModels`, `env.remoteHost`, `env.remotePathTemplate`, and browser cache settings.
- The installed `@xenova/transformers` v2 runtime exposes `env.backends.onnx.wasm.wasmPaths`; when bundling does not resolve ONNX Runtime files automatically, this path must point at the copied WASM assets.
- The installed Transformers.js v4 model catalog exposes `model_quantized.onnx` for SmolLM2; q4f16 is optimized for WebGPU, while the broad WASM path should use q8-compatible quantized weights. Unsupported q4f16-on-WASM initialization can stall after the large ONNX response without a useful exception.
- The loader now limits each CPU candidate to 120 seconds and performs a short `OK` warmup before exposing the composer as ready.

## Source URLs

- https://webllm.mlc.ai/docs/user/basic_usage.html
- https://huggingface.co/docs/transformers.js/en/index
- https://huggingface.co/docs/transformers.js/en/api/env
