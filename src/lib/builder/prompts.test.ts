import { describe, expect, it } from "vitest";
import { parseFileBlocks, parsePlan } from "./prompts";

const VALID_PLAN = `
Here is your plan:
{"features":["landing page","contact form"],"files":[{"path":"index.html","purpose":"main page"},{"path":"styles.css","purpose":"styling"}],"tasks":["write html","write css"]}
Good luck!
`;

describe("parsePlan", () => {
  it("extracts a plan from prose-wrapped JSON", () => {
    const plan = parsePlan(VALID_PLAN);
    expect(plan).not.toBeNull();
    expect(plan!.features).toEqual(["landing page", "contact form"]);
    expect(plan!.files).toHaveLength(2);
    expect(plan!.files[0]).toEqual({ path: "index.html", purpose: "main page" });
    expect(plan!.tasks).toEqual(["write html", "write css"]);
  });

  it("returns null for invalid JSON", () => {
    expect(parsePlan("no json here")).toBeNull();
    expect(parsePlan("{not valid json")).toBeNull();
    expect(parsePlan("{\"features\": [}")).toBeNull();
  });

  it("returns null when required arrays are missing or wrong type", () => {
    expect(parsePlan('{"features":"x","files":[]}')).toBeNull();
    expect(parsePlan('{"features":[],"files":"nope"}')).toBeNull();
    expect(parsePlan('{"features":[]}')).toBeNull();
  });

  it("returns null for empty files array", () => {
    expect(parsePlan('{"features":["a"],"files":[]}')).toBeNull();
  });

  it("returns null when a file entry is malformed", () => {
    expect(
      parsePlan('{"features":["a"],"files":[{"path":123,"purpose":"x"}]}'),
    ).toBeNull();
    expect(
      parsePlan('{"features":["a"],"files":[{"path":"x.html"}]}'),
    ).toBeNull();
    expect(parsePlan('{"features":["a"],"files":["index.html"]}')).toBeNull();
  });

  it("filters non-string features/tasks but keeps valid ones", () => {
    const plan = parsePlan(
      '{"features":["a",42,null],"files":[{"path":"a.html","purpose":"p"}],"tasks":["t1",false]}',
    );
    expect(plan!.features).toEqual(["a"]);
    expect(plan!.tasks).toEqual(["t1"]);
  });

  it("defaults tasks to [] when absent", () => {
    const plan = parsePlan(
      '{"features":[],"files":[{"path":"a.html","purpose":"p"}]}',
    );
    expect(plan!.tasks).toEqual([]);
  });

  it("rejects non-object JSON (arrays, strings)", () => {
    expect(parsePlan("[1,2,3]")).toBeNull();
  });
});

describe("parseFileBlocks", () => {
  it("extracts file blocks with paths", () => {
    const raw = `<<<FILE path="index.html">>>\n<h1>hi</h1>\n<<<END>>>\n<<<FILE path="a.css">>>\nbody{}\n<<<END>>>`;
    const blocks = parseFileBlocks(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ path: "index.html", content: "<h1>hi</h1>" });
    expect(blocks[1]).toEqual({ path: "a.css", content: "body{}" });
  });

  it("returns [] when no blocks present", () => {
    expect(parseFileBlocks("just some prose")).toEqual([]);
  });

  it("preserves inner newlines but strips one leading/trailing", () => {
    const raw = `<<<FILE path="x.txt">>>\nline1\n\nline3\n<<<END>>>`;
    const blocks = parseFileBlocks(raw);
    expect(blocks[0].content).toBe("line1\n\nline3");
  });
});
