# ALFRED

A local-first personal assistant for Apple Silicon, with a minimal macOS interface and a native iPhone companion. Experimental software focused on German conversation, local voice processing, and deliberately controlled memory. Documentation is in English; the current application UI is German.

## Features

- Browser chat and an Electron macOS app connected to Ollama.
- SQLite chat history, tasks, and separate, individually enabled user-approved memories; export and deletion controls.
- Voice conversations through Whisper, Pipecat/Ollama, and Piper. Start with the waveform button; end with X. The microphone pauses while ALFRED responds.
- SwiftUI iPhone app using inference on the Mac.
- HTTPS pairing with certificate fingerprint pinning and a revocable token. Optional remote access through Tailscale.

No genuine autonomy, general Mac control, automatic learning, or built-in live weather/web access. Responses can be incorrect.

## Quick start

Requirements: Node.js 24 and Ollama.

```sh
ollama pull qwen3:4b
ollama cp qwen3:4b alfred
cd Projektdateien/alfred-v0.3
npm ci
npm start
```

Open `http://127.0.0.1:3210`. The backend binds to localhost only. Personal data is created under the Git-ignored `data/` directory. `personality.json` contains the system prompt.

## Optional voice setup

On Apple Silicon with Python 3.11, run `Sprachlabor/Einrichten.command`, followed by `Stimmen/Thorsten/Einrichten.command`. These scripts download third-party packages and public weights. In the backend directory, run `npm run setup:voice` for Whisper weights. Pipecat voice mode also requires `ollama pull qwen3.5:4b-q4_K_M`.

No weights or Python environment are included. Browser mode locates the speech runtime relative to the project root; override with `ALFRED_PROJECT_DIR`. Conversations are turn-based: transcription and generation take time, and talking over the assistant is not implemented.

## macOS and iPhone

In `Projektdateien/ALFRED-Apps`, run `npm ci` and `npm run build:mac`. Set up speech and Whisper first; the build expects these local files. It produces an ad hoc signed app and ZIP, without Apple notarization. Its speech runtime references the checkout, so keep it available.

Open `iphone/ALFRED.xcodeproj` and select your own development team. Personal signing settings are excluded. Users grant camera, microphone, network, and Developer Mode permissions themselves. Free Personal Team signing requires periodic reinstallation.

For remote use, connect Tailscale on both devices using the same account. In the Mac menu choose `ALFRED → iPhone verbinden`, select the Tailscale address, and scan the QR code in the iPhone app. Pairing persists until revoked. The Mac must stay awake, online, and running ALFRED. Tailscale uses external coordination infrastructure; AI inference remains local.

**Own device builds:** replace the placeholder `100.64.0.1` in `iphone/ALFRED/Info.plist` with your Mac's Tailscale address. HTTPS, TLS 1.2, and exact QR certificate fingerprint matching remain mandatory. Do not add a global ATS exception.

## Verification

```sh
cd Projektdateien/alfred-v0.3
npm test
cd ../ALFRED-Apps
npm test
```

Native tests require macOS, Xcode/Swift, and Node.js 24. Backend tests use disposable databases. Automated tests do not establish microphone quality. The first hosted GitHub workflow passed backend/native tests and an unsigned iOS build: https://github.com/musti10/ALFRED/actions/runs/40607211460.

## Layout

| Directory | Contents |
|---|---|
| `Projektdateien/alfred-v0.3` | Current backend and browser UI; directory name is historical |
| `Projektdateien/ALFRED-Apps` | Electron, HTTPS gateway, and SwiftUI |
| `Sprachlabor` | Pipecat prototype and optional shared runtime |
| `Stimmen/Thorsten` | Voice download script and license notices |

## Vision

Build a JARVIS-inspired assistant named ALFRED: natural conversation, practical tools, contextual help, and clear user control. See [VISION.md](VISION.md). This describes our direction, not capabilities already delivered.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md). Reproducible improvements to German conversation, recognition, response quality, and latency on 16 GB systems are especially welcome. Never post private chats, QR codes, or credentials.

Original ALFRED code is MIT-licensed; see [LICENSE](LICENSE). Other components retain their own terms; see [THIRD-PARTY.md](THIRD-PARTY.md). This is an independent project, not affiliated with film studios or fictional-character rights holders.
