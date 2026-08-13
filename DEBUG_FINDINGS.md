# Browser runtime findings — 2026-08-13

The fresh worker-backed browser session now leaves the main thread responsive and displays the staged loading panel. After the bounded wait it reports: `This browser did not expose a usable WebGPU adapter.` followed by a CPU fallback failure because the rescue candidate requested `https://huggingface.co/Xenova/LaMini-GPT-124M/resolve/main/onnx/model_quantized.onnx`, which does not exist in that export.

The SmolLM2 q8 artifact is found and downloaded successfully, but its ONNX initialization exceeds the initial timeout in the managed preview. The next repair should keep a longer bounded window, show a “compiling decoder” heartbeat after download, and use LaMini’s actual `decoder_model_merged_quantized.onnx` file through the `model_file_name` option.

The longer worker test reached ONNX session creation and exposed the real incompatibility: `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale ...`. This means the `model_quantized.onnx` QDQ export is not compatible with the browser’s ONNX Runtime WASM build. The next candidate should use the plain `model_uint8.onnx` artifact instead of the QDQ q8 alias.

The verified LaMini export exposes `decoder_model_merged_quantized.onnx` at 128,316,534 bytes, while its earlier `model_quantized.onnx` path is absent. The runtime now prioritizes that explicit merged decoder file, then falls back to SmolLM2 `model_uint8.onnx`.

The explicit merged LaMini q8 test reaches the same ONNX `TransposeDQWeightsForMatMulNBits` missing-scale failure. The reliable CPU path is therefore switched to the non-quantized `decoder_model_merged.onnx` artifact (about 500 MB on first load; browser cache avoids repeat downloads), with SmolLM2 uint8 retained only as a secondary rescue candidate.

External artifacts checked:

- LaMini quantized: https://huggingface.co/Xenova/LaMini-GPT-124M/resolve/main/onnx/decoder_model_merged_quantized.onnx — 128,316,534 bytes; fails in the current ONNX Runtime WASM backend with the missing-scale QDQ error.
- LaMini non-quantized: https://huggingface.co/Xenova/LaMini-GPT-124M/resolve/main/onnx/decoder_model_merged.onnx — 500,802,211 bytes; selected as the reliable CPU candidate.
- SmolLM2 uint8: https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/onnx/model_uint8.onnx — a smaller secondary candidate, but it should remain a rescue path because the managed preview repeatedly surfaced the same QDQ scale error for the quantized SmolLM2 export.

The official FLAN-T5 model card documents Transformers.js `text2text-generation` usage at https://huggingface.co/Xenova/flan-t5-small. Its repository exposes a plain encoder-decoder layout: `encoder_model_quantized.onnx` (35,759,127 bytes) and `decoder_model_merged_quantized.onnx` (59,339,331 bytes), alongside non-quantized files. This is a better browser fallback candidate than the failing decoder-only QDQ path because it uses the supported text-to-text pipeline and has substantially smaller separate encoder/decoder artifacts.

Transformers.js v4 maps `dtype: "int8"` to the `_int8` suffix, while `dtype: "q8"` maps to `_quantized`. Therefore the FLAN-T5 int8 candidate requests `encoder_model_int8.onnx` and `decoder_model_merged_int8.onnx`, not the QDQ-labeled `_quantized` files. The worker should remove the LaMini q8 candidate and try FLAN-T5 int8 first.
