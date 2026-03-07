import { describe, expect, it } from "vitest";
import { stripPackSummary } from "../src/index.js";

const INSTRUCTIONS_WITH_PACKS = `OneTool calls pack tools via Python code through the \`run\` tool.

## Triggers
- \`>>>\` (recommended), \`__run\`, or \`mcp__onetool__run\`

## Call Rules
1. Keyword args only

## Available Packs
- **aws**: Manage AWS resources
- **brave**: Search the web
- **mem**: Persistent topic-based memory
Use \`ot.packs()\` for details. Not all packs are installed by default.

## Discovery
- Find tools: \`ot.help(query='search')\`

## Tool Output
- Do not explain what you are about to do`;

const INSTRUCTIONS_WITHOUT_PACKS = `OneTool calls pack tools via Python code through the \`run\` tool.

## Triggers
- \`>>>\` (recommended)

## Call Rules
1. Keyword args only`;

describe("stripPackSummary", () => {
  it("removes pack list lines, keeps section header and ot.packs() line", () => {
    const result = stripPackSummary(INSTRUCTIONS_WITH_PACKS);
    expect(result).toContain("## Available Packs\n");
    expect(result).toContain("Use `ot.packs()` for details.");
    expect(result).not.toContain("- **aws**:");
    expect(result).not.toContain("- **brave**:");
    expect(result).not.toContain("- **mem**:");
  });

  it("preserves sections before and after Available Packs", () => {
    const result = stripPackSummary(INSTRUCTIONS_WITH_PACKS);
    expect(result).toContain("## Triggers");
    expect(result).toContain("## Call Rules");
    expect(result).toContain("## Discovery");
    expect(result).toContain("## Tool Output");
  });

  it("returns instructions unchanged when no Available Packs section present", () => {
    const result = stripPackSummary(INSTRUCTIONS_WITHOUT_PACKS);
    expect(result).toBe(INSTRUCTIONS_WITHOUT_PACKS);
  });

  it("returns instructions unchanged when ot.packs() line is absent", () => {
    const noFooter = "## Available Packs\n- **brave**: Search\n\n## Discovery\n- something";
    const result = stripPackSummary(noFooter);
    expect(result).toBe(noFooter);
  });
});
