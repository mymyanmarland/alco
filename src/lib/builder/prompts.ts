/**
 * System prompts for the ALCO App Builder pipeline (M4).
 * Server-side only — never import from client components.
 *
 * Each prompt embeds a mode marker ([ALCO-BUILDER-MODE:*]) so the
 * mock-builder provider used in tests can respond deterministically.
 * Production prompts are identical; the mock only keys off the marker.
 */

export const BUILDER_MODE_MARKERS = {
  PLAN: "[ALCO-BUILDER-MODE:PLAN]",
  GENERATE: "[ALCO-BUILDER-MODE:GENERATE]",
  EDIT: "[ALCO-BUILDER-MODE:EDIT]",
} as const;

/** Marker scheme for file payloads: <<<FILE path="...">>> ... <<<END>>> */
export const FILE_OPEN_RE = /<<<FILE\s+path="([^"]+)"\s*>>>/g;
export const FILE_BLOCK_RE =
  /<<<FILE\s+path="([^"]+)"\s*>>>([\s\S]*?)<<<END>>>/g;

export interface PlanFile {
  path: string;
  purpose: string;
}

export interface BuildPlan {
  features: string[];
  files: PlanFile[];
  tasks: string[];
}

export function planSystemPrompt(): string {
  return `${BUILDER_MODE_MARKERS.PLAN}
You are the planner for ALCO, an AI app builder. The user describes a web
application. Respond with a build plan as STRICT JSON and nothing else — no
markdown fences, no prose before or after.

Required JSON shape:
{
  "features": ["short feature descriptions"],
  "files": [{"path": "relative/path.ext", "purpose": "what this file does"}],
  "tasks": ["ordered build steps"]
}

Rules:
- Keep the file list small and focused (2-12 files). Prefer a simple static
  site (index.html + styles.css + app.js) unless the user asks for more.
- All paths must be relative, use forward slashes, and stay inside the project
  root (never "..", never absolute paths).
- Use only common web extensions: html, css, js, jsx, ts, tsx, json, md, txt,
  svg, xml, yml, yaml, toml, ico, webmanifest.
- Never invent success or pretend a plan is a finished app. Output the JSON only.`;
}

export function generateSystemPrompt(
  plan: BuildPlan,
  alreadyGenerated: string[],
): string {
  const fileList = plan.files
    .map((f) => `- ${f.path} — ${f.purpose}`)
    .join("\n");
  const doneList =
    alreadyGenerated.length > 0
      ? alreadyGenerated.map((p) => `- ${p}`).join("\n")
      : "(none yet)";
  return `${BUILDER_MODE_MARKERS.GENERATE}
You are the code generator for ALCO, an AI app builder. Generate EXACTLY
ONE file — the one named in the user message as REQUESTED FILE.

Full plan for context:
Features: ${plan.features.join("; ") || "(none)"}
Files:
${fileList}
Already generated this run:
${doneList}

Output rules (follow exactly):
- Output ONLY the requested file, wrapped as:
  <<<FILE path="<exact requested path>">>>
  <complete file content>
  <<<END>>>
- No markdown fences, no explanations, no other files, no prose outside the markers.
- Write complete, working code. Keep imports/paths consistent with the plan.
- The path inside the marker MUST equal the requested path exactly.
- Never claim the app is built, tested, or deployed — you are only writing one file.`;
}

export function editSystemPrompt(
  files: { path: string; content: string }[],
): string {
  const context = files
    .map(
      (f) =>
        `<<<FILE path="${f.path}">>>\n${f.content}\n<<<END>>>`,
    )
    .join("\n\n");
  return `${BUILDER_MODE_MARKERS.EDIT}
You are the code editor for ALCO, an AI app builder. The user gives an
edit instruction. Current project files (read-only context):

${context}

Output rules (follow exactly):
- Return ONLY the files that must change, each wrapped as:
  <<<FILE path="<path>">>>
  <complete new content of that file>
  <<<END>>>
- Return the COMPLETE new content of each changed file, not a diff.
- Do not return unchanged files. Do not invent new files unless the
  instruction clearly requires one.
- No markdown fences, no explanations, no prose outside the markers.
- Never claim edits are tested or deployed — you only rewrote file content.`;
}

/**
 * Defensively extract and validate a BuildPlan from raw model output.
 * Returns the plan or null when the output is not a valid plan.
 */
export function parsePlan(raw: string): BuildPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.features) || !Array.isArray(p.files)) return null;
  const features = p.features.filter((f): f is string => typeof f === "string");
  const files: PlanFile[] = [];
  for (const f of p.files as unknown[]) {
    if (typeof f !== "object" || f === null) return null;
    const fo = f as Record<string, unknown>;
    if (typeof fo.path !== "string" || typeof fo.purpose !== "string")
      return null;
    files.push({ path: fo.path, purpose: fo.purpose });
  }
  if (files.length === 0) return null;
  const tasks = Array.isArray(p.tasks)
    ? p.tasks.filter((t): t is string => typeof t === "string")
    : [];
  return { features, files, tasks };
}

/**
 * Extract all <<<FILE path="...">>> ... <<<END>>> blocks from model output.
 */
export function parseFileBlocks(raw: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = new RegExp(FILE_BLOCK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    // Strip a single leading/trailing newline the model often adds.
    let content = m[2];
    if (content.startsWith("\n")) content = content.slice(1);
    if (content.endsWith("\n")) content = content.slice(0, -1);
    out.push({ path: m[1], content });
  }
  return out;
}
