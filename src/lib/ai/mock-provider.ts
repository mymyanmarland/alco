import { AIProvider, type TokenUsage } from "./types";

/**
 * Deterministic canned provider for tests and local development without a key.
 * Used only when AI_PROVIDER=mock. It chunks a fixed reply — it never pretends
 * to be a real model.
 */
const CANNED_REPLY = [
  "Hello! This is the **ALCO mock provider**.\n\n",
  "Streaming works across multiple chunks:\n\n",
  "- first chunk\n- second chunk\n\n",
  "```ts\nconst hello = 'world';\n```\n\n",
  "In production this reply comes from your configured AI provider.",
];

export class MockProvider implements AIProvider {
  readonly name = "mock";
  lastUsage: TokenUsage | null = null;

  // Fewer parameters than the interface declares is assignable in TS;
  // the mock intentionally ignores input.
  async *streamChat(): AsyncIterable<string> {
    this.lastUsage = null;
    for (const chunk of CANNED_REPLY) {
      yield chunk;
    }
  }
}
