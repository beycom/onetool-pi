import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, getMarkdownTheme, truncateTail } from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "@sinclair/typebox";

type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const YAML_KEYWORDS = new Set(["true", "false", "null", "yes", "no", "on", "off"]);

function needsYamlQuotes(s: string): boolean {
  if (s.length === 0) return true;
  if (YAML_KEYWORDS.has(s.toLowerCase())) return true;
  if (/[:{}\[\],#&*?|<>=!%@`'"\\]/.test(s)) return true;
  if (/^[-\s]/.test(s)) return true;
  return false;
}

function toYamlBlock(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return needsYamlQuotes(value) ? JSON.stringify(value) : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return `${pad}-\n${toYamlBlock(item, indent + 1)}`;
        }
        return `${pad}- ${toYamlBlock(item, indent + 1)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null) {
          return `${pad}${k}:\n${toYamlBlock(v, indent + 1)}`;
        }
        return `${pad}${k}: ${toYamlBlock(v, indent + 1)}`;
      })
      .join("\n");
  }
  return String(value);
}

// Strip security boundary tag lines added by onetool's sanitize_output.
// Tags are always on their own line in one of three styles:
//   # <external-content-XXXX>          (YAML comment — yml/yml_f formats)
//   /* <external-content-XXXX> */      (JS block comment — json formats)
//   <external-content-XXXX>            (XML — raw/fallback formats)
// Server-side sanitization already replaces any real content containing this
// pattern with [REDACTED:tag], so filtering on "external-content-" is safe.
export function stripBoundaryTags(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.includes("external-content-"))
    .join("\n")
    .trim();
}

export function buildDisplayString(result: { content: ContentBlock[] }): string {
  const raw = result.content
    .map((b) => (b.type === "image" ? `[image: ${b.mimeType}]` : b.text))
    .join("\n");

  const text = stripBoundaryTags(raw);

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      return parsed;
    }
    return "```yaml\n" + toYamlBlock(parsed) + "\n```";
  } catch {
    return text;
  }
}

export function renderAsMarkdown(result: { content: ContentBlock[] }): Markdown {
  return new Markdown(buildDisplayString(result), 1, 0, getMarkdownTheme());
}

export function buildCollapsedDisplay(display: string, previewLines: number): string {
  const lines = display.split("\n");
  if (lines.length > previewLines) {
    const preview = lines.slice(0, previewLines).join("\n");
    return preview + `\n\n_… ${lines.length - previewLines} more lines — click to expand_`;
  }
  const charLimit = previewLines * 100;
  if (display.length > charLimit) {
    return display.slice(0, charLimit) + `\n\n_… more — click to expand_`;
  }
  return display;
}

const DEFAULT_PREVIEW_LINES = 10;

let client: Client | null = null;
let connectPromise: Promise<Client> | null = null;
let serverInstructions: string | undefined;

// Strip the ## Available Packs section from server instructions to reduce token cost.
// The pack list (~200 tokens) is already accessible via ot.packs(); the surrounding
// sections (triggers, call rules, discovery, security) are preserved.
export function stripPackSummary(instructions: string): string {
  return instructions.replace(/(## Available Packs\n)[\s\S]*?(Use `ot\.packs\(\)`)/, "$1$2");
}

let connectionTimeout = 10_000;
let maxBytesOverride: number | undefined;
let maxLinesOverride: number | undefined;
let previewLinesOverride: number | undefined;

function readOnetoolSettings(settingsPath: string): {
  command?: string;
  args?: string[];
  connectTimeout?: number;
  maxBytes?: number;
  maxLines?: number;
  previewLines?: number;
} | null {
  if (!existsSync(settingsPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const o = raw?.onetool;
    if (!o || typeof o !== "object") return null;
    return {
      command: typeof o.command === "string" ? o.command : undefined,
      args: Array.isArray(o.args) ? o.args : undefined,
      connectTimeout: typeof o.connectTimeout === "number" ? o.connectTimeout : undefined,
      maxBytes: typeof o.maxBytes === "number" ? o.maxBytes : undefined,
      maxLines: typeof o.maxLines === "number" ? o.maxLines : undefined,
      previewLines: typeof o.previewLines === "number" ? o.previewLines : undefined,
    };
  } catch {
    return null;
  }
}

function resolveFullSettings(): {
  command: string;
  args: string[];
  connectTimeout?: number;
  maxBytes?: number;
  maxLines?: number;
  previewLines?: number;
} {
  const projectSettings = readOnetoolSettings(join(process.cwd(), ".pi", "settings.json"));
  if (projectSettings?.command) {
    return {
      command: projectSettings.command,
      args: projectSettings.args ?? [],
      connectTimeout: projectSettings.connectTimeout,
      maxBytes: projectSettings.maxBytes,
      maxLines: projectSettings.maxLines,
      previewLines: projectSettings.previewLines,
    };
  }

  const globalSettings = readOnetoolSettings(join(homedir(), ".pi", "agent", "settings.json"));
  if (globalSettings?.command) {
    return {
      command: globalSettings.command,
      args: globalSettings.args ?? [],
      connectTimeout: globalSettings.connectTimeout,
      maxBytes: globalSettings.maxBytes,
      maxLines: globalSettings.maxLines,
      previewLines: globalSettings.previewLines,
    };
  }

  throw new Error('onetool not configured — add "onetool.command" to .pi/settings.json');
}

// Resolve how to invoke onetool: project .pi/settings.json > global ~/.pi/agent/settings.json > error
// Settings format mirrors .mcp.json: { command, args }
export function resolveConnection(): { command: string; args: string[] } {
  const { command, args } = resolveFullSettings();
  return { command, args };
}

// Transform MCP content[] to Pi ContentBlock[]
export function transformContent(result: unknown): ContentBlock[] {
  if (!result || typeof result !== "object") {
    return [{ type: "text", text: String(result) }];
  }

  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) {
    return [{ type: "text", text: String(result) }];
  }

  const content = r.content as Array<Record<string, unknown>>;
  if (content.length === 0) {
    return [{ type: "text", text: "(empty)" }];
  }

  return content.map((item) => {
    if (item.type === "image" && item.data) {
      return {
        type: "image" as const,
        data: String(item.data),
        mimeType: String(item.mimeType ?? "image/png"),
      };
    }
    return { type: "text" as const, text: String(item.text ?? "") };
  });
}

// Apply truncateTail per text block; pass image blocks unchanged
export function truncateBlocks(
  blocks: ContentBlock[],
  opts?: { maxBytes?: number; maxLines?: number },
): ContentBlock[] {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
  return blocks.map((block) => {
    if (block.type !== "text") return block;
    const result = truncateTail(block.text, { maxBytes, maxLines });
    if (result.truncated) {
      return {
        type: "text" as const,
        text: result.content + "\n[output truncated — use ctx or pagination to retrieve the full result]",
      };
    }
    return { type: "text" as const, text: result.content };
  });
}

// Get (or create) MCP client with connectPromise dedup
async function getClient(): Promise<Client> {
  if (client) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const { command, args } = resolveConnection();

    const transport = new StdioClientTransport({ command, args, stderr: "ignore" });

    const newClient = new Client({ name: "onetool-pi", version: "2.1.0" });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`onetool connection timed out after ${connectionTimeout}ms`)),
        connectionTimeout,
      ),
    );

    await Promise.race([newClient.connect(transport), timeout]);
    client = newClient;
    serverInstructions = newClient.getInstructions();
    return client;
  })();

  // Clear connectPromise on rejection so the next call creates a fresh attempt
  connectPromise.catch(() => {
    connectPromise = null;
  });

  return connectPromise;
}

export default function (pi: ExtensionAPI) {
  let configError: string | null = null;

  try {
    const settings = resolveFullSettings();
    connectionTimeout = settings.connectTimeout ?? 10_000;
    maxBytesOverride = settings.maxBytes;
    maxLinesOverride = settings.maxLines;
    previewLinesOverride = settings.previewLines;
  } catch (err) {
    configError = (err as Error).message;
  }

  // Config not found — register placeholder tool
  if (configError) {
    const errMsg = configError;
    pi.registerTool({
      name: "ot",
      label: "OneTool (not configured)",
      description: errMsg,
      parameters: Type.Object({
        command: Type.String({ description: "Python expression to run" }),
      }),
      execute: async () => {
        return { content: [{ type: "text", text: errMsg }], details: {} };
      },
    });
    return;
  }

  // Register the ot tool
  pi.registerTool({
    name: "ot",
    label: "OneTool",
    description: `Run Python expressions against OneTool's 20+ tool packs.

Start with discovery:
  ot.packs()                           # list all available packs
  ot.help(query='search')              # find tools by keyword
  ot.tools(pattern='brave')            # list tools in a pack

Examples:
  brave.search(query='latest AI news') # web search
  wf.fetch(url='...')                  # fetch a URL
  mem.write(topic='notes', text='...') # write to memory
  ot_llm.transform(text='...', prompt='summarize')

Chain results in one call:
  results = brave.search(query='fastapi'); ot_llm.transform(text=results, prompt='summarize')`,
    parameters: Type.Object({
      command: Type.String({
        description: "Python expression or multi-statement code to execute via onetool",
      }),
    }),
    renderCall: (args) => new Markdown("🧿 " + (args as { command: string }).command, 1, 0, getMarkdownTheme()),
    renderResult: (result, options) => {
      const blocks = result as { content: ContentBlock[] };
      const display = buildDisplayString(blocks);
      if (options?.expanded) {
        return new Markdown(display, 1, 0, getMarkdownTheme());
      }
      const collapsed = buildCollapsedDisplay(display, previewLinesOverride ?? DEFAULT_PREVIEW_LINES);
      return new Markdown(collapsed, 1, 0, getMarkdownTheme());
    },
    execute: async (_toolCallId, params, signal) => {
      // Abort signal short-circuit
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      }

      try {
        const c = await getClient();
        const result = await c.callTool(
          { name: "run", arguments: { command: params.command } },
          undefined,
          { signal },
        );
        const blocks = transformContent(result);
        const truncated = truncateBlocks(blocks, { maxBytes: maxBytesOverride, maxLines: maxLinesOverride });
        return { content: truncated, details: {} };
      } catch (err) {
        // Reset connection state on error
        client = null;
        connectPromise = null;
        const msg = `onetool error: ${(err as Error).message}`;
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // Inject server instructions into Pi's system prompt before each agent turn.
  // Uses before_agent_start so Pi's AI receives the same pass-through rule,
  // call rules, and discovery pointers that Claude gets via MCP initialize.
  // The Available Packs section is stripped to reduce token cost (~150 tokens vs ~400).
  pi.on("before_agent_start", async (event) => {
    if (!serverInstructions) return;
    const stripped = stripPackSummary(serverInstructions);
    return { systemPrompt: event.systemPrompt + "\n\n## OneTool\n\n" + stripped };
  });

  // Pre-warm connection
  getClient().catch((err) => {
    console.error(`onetool: failed to connect — ${(err as Error).message}`);
  });

  // /ot command
  pi.registerCommand("ot", {
    description: "Manage the OneTool connection. Usage: /ot [restart|status]",
    handler: async (args, ctx) => {
      const sub = args.trim() || "restart";

      if (sub === "status") {
        const msg = client ? "onetool: connected" : "onetool: disconnected";
        if (ctx.hasUI) ctx.ui.notify(msg);
        return;
      }

      if (sub === "restart") {
        if (client) {
          await client.close().catch(() => {});
          client = null;
        }
        connectPromise = null;
        if (ctx.hasUI) ctx.ui.notify("onetool: restarting...");
        try {
          await getClient();
          if (ctx.hasUI) ctx.ui.notify("onetool: connected");
        } catch (err) {
          if (ctx.hasUI) ctx.ui.notify(`onetool: failed — ${(err as Error).message}`, "error");
        }
        return;
      }

      if (ctx.hasUI) ctx.ui.notify("Usage: /ot [restart|status]");
    },
  });

  // Close client on session shutdown
  pi.on("session_shutdown", async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
  });
}
