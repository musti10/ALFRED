# Copilot-assisted review and checked roadmap

On 2026-10-28, GitHub Copilot Chat reviewed `musti10/ALFRED` with the repository attached. We asked for a JARVIS-inspired ALFRED architecture review covering German conversation, useful tools, speech quality, and realistic M2 Pro / 16 GB operation. No implementation was requested from Copilot.

A second round challenged incorrect or overbroad initial claims. This document records the resulting priorities and code cross-checks; it is not a human security audit or a performance benchmark.

## Corrections made during the discussion

- Pipecat orchestrates the existing Ollama model; it is not another loaded LLM.
- `server.ts` already serializes model work using `busy`; `outputBusy` separately protects speech synthesis. The concrete gap is asymmetric exclusion: synthesis rejects an active `busy` request, while transcription and chat do not reject `outputBusy` in their current guards. Measure the resource impact; do not claim an observed out-of-memory failure.
- Current native TTS is Piper through `integrations/speech-worker.py`. Browser output already has sentence splitting and a queue in `public/audio-reader.js`. Older `say` / browser speech paths must not be confused with this integration.
- The current Piper runtime is `piper-tts==1.8.0` from OHF-Voice/piper1-gpl, GPL-3.0. It is not the earlier MIT runtime.
- The small set of enabled, manually approved memory facts is deliberate. Missing vector retrieval is a future scaling question, not evidence that approval is bypassed.
- HTTPS pinning is enforced by the iPhone client; the gateway provides TLS and token/route checks. These responsibilities must be described accurately.

## 1. Conversational reliability

**First proposed change:** consistent exclusion for active inference, plus a testable speech-turn state machine.

Relevant files: `server.ts`, `iphone/ALFRED/VoiceDialog.swift`, `public/recorder-worklet.js`, and existing voice/cancellation tests.

The iPhone currently decides speech using a fixed energy threshold and 1.4 seconds of silence. This is observable in code; the actual false-positive and truncation rate still needs measurements. Simply shortening the silence timeout is not an established improvement. A state machine alone also does not prove semantic end-of-turn detection.

Acceptance criteria:

- A synthesis request in progress prevents overlapping transcription/chat inference, and vice versa, with deterministic busy responses and cleanup after cancellation.
- Synthetic and recorded German fixtures cover short pauses, longer clause pauses, background noise, silence, cancellation, and the maximum recording limit.
- X ends capture/playback and never starts another microphone cycle.
- Compare transcript accuracy, time to first audio, peak memory, and end-of-turn errors on the reference machine before changing defaults.

Candidates: [Silero VAD](https://github.com/snakers4/silero-vad) (MIT), [Smart Turn](https://github.com/pipecat-ai/smart-turn) (BSD-2-Clause). Evaluate them separately before adding dependencies or changing the audio transport.

## 2. Grounded, narrowly scoped tools

**First proposed capability:** real weather lookup with a source and retrieval time, rather than an answer invented from model knowledge.

Then consider explicitly selected calendar data and document Q&A. Keep source documents separate from long-term approved memory. Use typed tool inputs and structured outputs; reject unknown tools and never execute arbitrary shell text.

Acceptance criteria:

- A current-information question receives actual source data or an honest unavailable response.
- External requests are visible and user-enabled. A direct request to perform an enabled read-only lookup should not require repetitive extra confirmations.
- External writes and destructive actions require concrete approval before execution.
- Selected-file boundaries, disabled memories, unavailable networks, and prompt injection in retrieved data have dedicated tests.

Potential starting point: [Open-Meteo](https://github.com/open-meteo/open-meteo). API/data terms and server-code licensing must be evaluated separately; no new provider has been integrated by this review.

## 3. Voice quality with measured comparisons

**First proposed change:** benchmark the current Piper path and its repeated worker/model-loading cost, then compare pacing and alternative German voices using the same phrases.

Keep the working Thorsten baseline. Browser output already chunks sentences; iPhone output currently requests a complete reply. Improvements must account for both clients rather than changing an unused legacy path.

Acceptance criteria:

- German abbreviations, URLs, decimals, and final sentence endings remain intact.
- Compare a fixed listening set, synthesis time, first-audio delay, and combined memory use with the LLM loaded.
- Do not claim a new voice sounds more natural without listening tests.
- Review code, runtime, and model-weight licenses separately before redistributing artifacts.

Candidates: [MLX-Audio](https://github.com/Blaizzy/mlx-audio) (MIT code), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) model variants with German support, and the current [Piper runtime](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0). Individual model terms and actual 16 GB performance still require checking.

## Current verification and community input

The initial release passed 18 backend tests, 7 native/gateway/Swift validation tests, and an unsigned iPhone build, including hosted GitHub Actions. This review adds a plan, not those future features.

Public feedback thread: https://github.com/musti10/ALFRED/issues/1

GitHub license metadata was checked for Silero VAD, Smart Turn, MLX-Audio, Piper, and whisper.cpp. License metadata does not replace reviewing the particular code or model version selected for integration.
