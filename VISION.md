# Vision: JARVIS-inspired capabilities, ALFRED identity

ALFRED should become a useful everyday assistant across Mac and iPhone, with natural German conversation and a calm, concise personality. The inspiration is the functional experience of a fictional JARVIS-like assistant; no claim of fictional intelligence, unrestricted access, or affiliation is intended.

## Priorities

1. **Reliable conversation:** recognize full sentences, reduce waiting, answer directly, admit uncertainty, and never invent live information or completed actions.
2. **Practical knowledge:** explicitly enabled weather/search with sources, calendar lookup, and questions about deliberately selected documents. Keep document storage separate from approved personal memory.
3. **Controlled actions:** a small registry of typed tools, narrow permissions, visible outcomes, and explicit confirmation for external writes or destructive actions. Model-generated text must never become an arbitrary shell command.
4. **Useful continuity:** retain conversation context, offer useful next steps without repetitive questions, and let users inspect, edit, pause, or delete memories. No silent collection of personal facts.
5. **Cross-device availability:** secure pairing across networks now; evaluate dedicated hosting or on-device inference later.

## Engineering constraints

- Reference hardware: Apple Silicon M2 Pro with 16 GB RAM. Benchmark end-to-end latency and total memory, not isolated model demos.
- Prefer narrowly integrated existing open-source components. Record source, version, and license.
- Keep a working baseline and compare proposed improvements using the same German questions and recordings.
- Distinguish implemented features, measured improvements, and experiments.
- No silent cloud fallback, unrestricted agent privileges, or claims of genuine autonomy.

## First review questions

Which current limitation most harms the assistant experience? What is the smallest useful fix? How can we verify it on the reference hardware? Copilot and community feedback are advisory; proposals must be checked against the code and tested before adoption.
