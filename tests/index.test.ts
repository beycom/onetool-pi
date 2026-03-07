import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCollapsedDisplay,
  buildDisplayString,
  resolveConnection,
  stripBoundaryTags,
  transformContent,
  truncateBlocks,
} from "../src/index.js";


// Mock node:os so we can control homedir() per test
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function freshDir() {
  return mkdtempSync(join(tmpdir(), "onetool-pi-test-"));
}

function writePiSettings(dir: string, onetool: object) {
  const piDir = join(dir, ".pi");
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "settings.json"), JSON.stringify({ onetool }));
}

// ─── resolveConnection ──────────────────────────────────────────────────────

describe("resolveConnection", () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    vi.mocked(homedir).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.mocked(homedir).mockReset();
  });

  it("throws when nothing is configured", () => {
    process.chdir(freshDir());
    vi.mocked(homedir).mockReturnValue(freshDir());
    expect(() => resolveConnection()).toThrow(/onetool\.command/);
  });

  it("resolves via project .pi/settings.json", () => {
    const projDir = freshDir();
    process.chdir(projDir);
    vi.mocked(homedir).mockReturnValue(freshDir());
    writePiSettings(projDir, {
      command: "/proj/onetool",
      args: ["--config", "/proj/onetool.yaml", "--secrets", "/proj/secrets.yaml"],
    });

    const result = resolveConnection();
    expect(result.command).toBe("/proj/onetool");
    expect(result.args).toContain("--config");
  });

  it("resolves via global ~/.pi/agent/settings.json", () => {
    const projDir = freshDir();
    const homeDir = freshDir();
    process.chdir(projDir);
    vi.mocked(homedir).mockReturnValue(homeDir);
    const agentDir = join(homeDir, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ onetool: { command: "/global/onetool", args: [] } })
    );

    const result = resolveConnection();
    expect(result.command).toBe("/global/onetool");
  });

  it("reads connectTimeout from settings", () => {
    const projDir = freshDir();
    process.chdir(projDir);
    vi.mocked(homedir).mockReturnValue(freshDir());
    writePiSettings(projDir, { command: "/proj/onetool", args: [], connectTimeout: 5000 });
    // resolveConnection only returns command/args; just verify it doesn't throw
    const result = resolveConnection();
    expect(result.command).toBe("/proj/onetool");
  });

  it("reads maxBytes and maxLines from settings without error", () => {
    const projDir = freshDir();
    process.chdir(projDir);
    vi.mocked(homedir).mockReturnValue(freshDir());
    writePiSettings(projDir, { command: "/proj/onetool", args: [], maxBytes: 1000, maxLines: 50 });
    const result = resolveConnection();
    expect(result.command).toBe("/proj/onetool");
  });
});

// ─── transformContent ────────────────────────────────────────────────────────

describe("transformContent", () => {
  it("unwraps MCP text content array to multiple text blocks", () => {
    const result = transformContent({
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    });
    expect(result).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
  });

  it("preserves image content blocks", () => {
    const result = transformContent({
      content: [{ type: "image", data: "abc123", mimeType: "image/png" }],
    });
    expect(result).toEqual([{ type: "image", data: "abc123", mimeType: "image/png" }]);
  });

  it("returns (empty) for empty content array", () => {
    const result = transformContent({ content: [] });
    expect(result).toEqual([{ type: "text", text: "(empty)" }]);
  });

  it("falls back to String() for unknown shape", () => {
    const result = transformContent("raw string");
    expect(result).toEqual([{ type: "text", text: "raw string" }]);

    const result2 = transformContent({ noContent: true });
    expect(result2).toEqual([{ type: "text", text: "[object Object]" }]);
  });
});

// ─── truncateBlocks ──────────────────────────────────────────────────────────

describe("truncateBlocks", () => {
  it("truncates long text blocks and passes image blocks unchanged", () => {
    const longText = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const imageBlock = { type: "image" as const, data: "abc", mimeType: "image/png" };

    const result = truncateBlocks([{ type: "text", text: longText }, imageBlock]);

    expect(result[0].type).toBe("text");
    const lines = (result[0] as { type: "text"; text: string }).text.split("\n");
    expect(lines.length).toBeLessThan(3000);

    expect(result[1]).toEqual(imageBlock);
  });

  it("passes short text blocks unchanged", () => {
    const result = truncateBlocks([{ type: "text" as const, text: "short text" }]);
    expect(result[0]).toEqual({ type: "text", text: "short text" });
  });

  it("appends truncation warning when text is truncated", () => {
    const longText = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateBlocks([{ type: "text", text: longText }]);
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("[output truncated");
  });

  it("does not append truncation warning for short text", () => {
    const result = truncateBlocks([{ type: "text" as const, text: "short" }]);
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("[output truncated");
  });

  it("respects maxLines override", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    // 20 lines should not be truncated by default, but should be with maxLines: 5
    const truncated = truncateBlocks([{ type: "text", text }], { maxLines: 5 });
    const out = (truncated[0] as { type: "text"; text: string }).text;
    expect(out).toContain("[output truncated");
  });

  it("respects maxBytes override", () => {
    const text = "x".repeat(200);
    const truncated = truncateBlocks([{ type: "text", text }], { maxBytes: 10 });
    const out = (truncated[0] as { type: "text"; text: string }).text;
    expect(out).toContain("[output truncated");
  });
});

// ─── stripBoundaryTags ───────────────────────────────────────────────────────

describe("stripBoundaryTags", () => {
  it("passes through text with no boundary tags unchanged", () => {
    expect(stripBoundaryTags("hello world")).toBe("hello world");
    expect(stripBoundaryTags('{"key": "value"}')).toBe('{"key": "value"}');
  });

  it("strips yaml-comment style tags (yml/yml_f format)", () => {
    const input = [
      "# <external-content-a1b2>",
      "{key: value}",
      "# </external-content-a1b2>",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("{key: value}");
  });

  it("strips yaml-comment tags inside a markdown fence (yml_f format)", () => {
    const input = [
      "```yaml",
      "# <external-content-a1b2>",
      "{key: value}",
      "# </external-content-a1b2>",
      "```",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("```yaml\n{key: value}\n```");
  });

  it("strips js-block-comment style tags (json format)", () => {
    const input = [
      "/* <external-content-a1b2> */",
      '{"key": "value"}',
      "/* </external-content-a1b2> */",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe('{"key": "value"}');
  });

  it("strips xml-style tags (raw/fallback format)", () => {
    const input = [
      "<external-content-a1b2>",
      "some plain text",
      "</external-content-a1b2>",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("some plain text");
  });

  it("strips tags that include a source attribute", () => {
    const input = [
      '# <external-content-a1b2 source="tool.name">',
      "{key: value}",
      "# </external-content-a1b2>",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("{key: value}");
  });

  it("strips multiple boundary regions", () => {
    const input = [
      "# <external-content-aaaa>",
      "first: result",
      "# </external-content-aaaa>",
      "# <external-content-bbbb>",
      "second: result",
      "# </external-content-bbbb>",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("first: result\nsecond: result");
  });

  it("returns empty string for empty input", () => {
    expect(stripBoundaryTags("")).toBe("");
  });

  it("preserves [REDACTED:tag] in content (server-sanitized injection attempts)", () => {
    const input = [
      "# <external-content-a1b2>",
      "safe content with [REDACTED:tag] inside",
      "# </external-content-a1b2>",
    ].join("\n");
    expect(stripBoundaryTags(input)).toBe("safe content with [REDACTED:tag] inside");
  });
});

// ─── buildDisplayString ───────────────────────────────────────────────────────

describe("buildDisplayString", () => {
  it("plain JSON string value is not wrapped in YAML fence", () => {
    const display = buildDisplayString({ content: [{ type: "text", text: '"hello"' }] });
    expect(display).toBe("hello");
    expect(display).not.toContain("```yaml");
  });

  it("JSON object is wrapped in YAML fence with block style", () => {
    const obj = { key: "value", nested: { a: 1 } };
    const display = buildDisplayString({ content: [{ type: "text", text: JSON.stringify(obj) }] });
    expect(display).toContain("```yaml");
    // Block style: keys on their own lines (not flow `{key: value}`)
    expect(display).toContain("key: value");
    expect(display).toContain("nested:");
  });

  it("nested object uses indented block style", () => {
    const obj = { outer: { inner: 42 } };
    const display = buildDisplayString({ content: [{ type: "text", text: JSON.stringify(obj) }] });
    expect(display).toContain("outer:");
    expect(display).toContain("inner: 42");
    // Should NOT be flow style like {outer: {inner: 42}}
    expect(display).not.toContain("{outer:");
  });

  it("image block renders as [image: <mimeType>] placeholder", () => {
    const display = buildDisplayString({
      content: [{ type: "image", data: "abc", mimeType: "image/jpeg" }],
    });
    expect(display).toContain("[image: image/jpeg]");
  });

  it("mixed text and image: image gets placeholder alongside text", () => {
    const display = buildDisplayString({
      content: [
        { type: "text", text: "result:" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
    });
    expect(display).toContain("[image: image/png]");
    expect(display).toContain("result:");
  });

  it("non-JSON plain text is rendered as-is", () => {
    const display = buildDisplayString({ content: [{ type: "text", text: "plain markdown **text**" }] });
    expect(display).toBe("plain markdown **text**");
  });

  it("JSON array is rendered as block YAML list", () => {
    const arr = [{ name: "alice" }, { name: "bob" }];
    const display = buildDisplayString({ content: [{ type: "text", text: JSON.stringify(arr) }] });
    expect(display).toContain("```yaml");
    expect(display).toContain("name: alice");
    expect(display).toContain("name: bob");
  });
});

// ─── buildCollapsedDisplay ────────────────────────────────────────────────────

describe("buildCollapsedDisplay", () => {
  it("returns display unchanged when lines <= previewLines", () => {
    const display = "line1\nline2\nline3";
    expect(buildCollapsedDisplay(display, 5)).toBe(display);
    expect(buildCollapsedDisplay(display, 3)).toBe(display);
  });

  it("truncates to previewLines and appends more-lines notice", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const display = lines.join("\n");
    const result = buildCollapsedDisplay(display, 10);
    const resultLines = result.split("\n");
    // First 10 content lines, then blank line, then notice
    expect(resultLines[0]).toBe("line1");
    expect(resultLines[9]).toBe("line10");
    expect(result).toContain("10 more lines");
    expect(result).toContain("click to expand");
  });

  it("count in notice is total minus previewLines", () => {
    const display = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
    const result = buildCollapsedDisplay(display, 5);
    expect(result).toContain("10 more lines");
  });

  it("single line display is returned unchanged", () => {
    expect(buildCollapsedDisplay("just one line", 10)).toBe("just one line");
  });

  it("collapses a single long line that exceeds previewLines * 100 chars", () => {
    const longLine = "x".repeat(1100); // > 10 * 100
    const result = buildCollapsedDisplay(longLine, 10);
    expect(result).toContain("click to expand");
    // Preview is char-truncated to previewLines * 100
    expect(result.startsWith("x".repeat(1000))).toBe(true);
  });

  it("uses 'more' label (not 'more lines') when char threshold triggers", () => {
    const longLine = "x".repeat(1100);
    const result = buildCollapsedDisplay(longLine, 10);
    expect(result).toContain("… more — click to expand");
    expect(result).not.toContain("more lines");
  });
});

// ─── E2E Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!process.env.ONETOOL_E2E)("e2e", () => {
  it("connects via StdioClientTransport and calls run with ot.packs()", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const { command, args } = resolveConnection();
    const transport = new StdioClientTransport({ command, args });
    const client = new Client({ name: "onetool-pi-e2e", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "run", arguments: { command: "ot.packs()" } });
      const text = JSON.stringify(result);
      expect(text).toMatch(/brave|webfetch|ripgrep|ot_llm/i);
    } finally {
      await client.close().catch(() => {});
    }
  }, 30_000);
});
