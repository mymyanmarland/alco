/**
 * Deterministic mock for the App Builder pipeline (M4 tests).
 * Used only when AI_PROVIDER=mock-builder. It keys off the
 * [ALCO-BUILDER-MODE:*] marker in the system prompt and returns
 * fixed, valid payloads — never pretending to be a real model.
 */
import { BUILDER_MODE_MARKERS } from "./prompts";
import type { AIProvider, ChatMessage, TokenUsage } from "../ai/types";

const MOCK_PLAN_JSON = JSON.stringify({
  features: ["Landing hero", "Styles"],
  files: [
    { path: "index.html", purpose: "Landing page" },
    { path: "styles.css", purpose: "Styles" },
  ],
  tasks: ["Write index.html", "Write styles.css"],
});

const MOCK_FILES: Record<string, string> = {
  "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mock App</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<h1>Hello ALCO</h1>
<p>Built by the mock builder.</p>
</body>
</html>`,
  "styles.css": `body { color: navy; font-family: sans-serif; }
h1 { color: #8257f5; }`,
};

const MOCK_EDITED_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mock App</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<h1>Hello ALCO (edited)</h1>
<p>Built by the mock builder.</p>
</body>
</html>`;

function requestedFile(messages: ChatMessage[]): string {
  const user = [...messages].reverse().find((m) => m.role === "user");
  const m = user?.content.match(/REQUESTED FILE:\s*(\S+)/);
  return m ? m[1] : "index.html";
}

export class MockBuilderProvider implements AIProvider {
  readonly name = "mock-builder";
  lastUsage: TokenUsage | null = null;

  async *streamChat(messages: ChatMessage[]): AsyncIterable<string> {
    this.lastUsage = null;
    const system =
      messages.find((m) => m.role === "system")?.content ?? "";
    if (system.includes(BUILDER_MODE_MARKERS.PLAN)) {
      yield MOCK_PLAN_JSON;
      return;
    }
    if (system.includes(BUILDER_MODE_MARKERS.GENERATE)) {
      const file = requestedFile(messages);
      const content = MOCK_FILES[file] ?? `/* mock content for ${file} */`;
      yield `<<<FILE path="${file}">>>\n${content}\n<<<END>>>`;
      return;
    }
    if (system.includes(BUILDER_MODE_MARKERS.EDIT)) {
      yield `<<<FILE path="index.html">>>\n${MOCK_EDITED_INDEX}\n<<<END>>>`;
      return;
    }
    yield "mock-builder: unrecognized builder mode";
  }
}
