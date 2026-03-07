import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveConnection } from "../src/index.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

function settingsJson(onetool: object) {
  return JSON.stringify({ onetool });
}

describe("resolveConnection", () => {
  it("uses project .pi/settings.json", () => {
    const projectPath = join(process.cwd(), ".pi", "settings.json");
    mockExistsSync.mockImplementation((p) => p === projectPath);
    mockReadFileSync.mockImplementation((p) =>
      p === projectPath
        ? settingsJson({ command: "/proj/onetool", args: ["--config", "/proj/onetool.yaml"] })
        : "{}"
    );

    const result = resolveConnection();
    expect(result.command).toBe("/proj/onetool");
    expect(result.args).toEqual(["--config", "/proj/onetool.yaml"]);
  });

  it("falls back to global ~/.pi/agent/settings.json", () => {
    const globalPath = join(homedir(), ".pi", "agent", "settings.json");
    mockExistsSync.mockImplementation((p) => p === globalPath);
    mockReadFileSync.mockImplementation((p) =>
      p === globalPath
        ? settingsJson({ command: "/global/onetool", args: ["--config", "/global/onetool.yaml"] })
        : "{}"
    );

    const result = resolveConnection();
    expect(result.command).toBe("/global/onetool");
  });

  it("project settings takes precedence over global", () => {
    const projectPath = join(process.cwd(), ".pi", "settings.json");
    const globalPath = join(homedir(), ".pi", "agent", "settings.json");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (p === projectPath) return settingsJson({ command: "/proj/onetool", args: [] });
      if (p === globalPath) return settingsJson({ command: "/global/onetool", args: [] });
      return "{}";
    });

    const result = resolveConnection();
    expect(result.command).toBe("/proj/onetool");
  });

  it("defaults args to [] when omitted", () => {
    const projectPath = join(process.cwd(), ".pi", "settings.json");
    mockExistsSync.mockImplementation((p) => p === projectPath);
    mockReadFileSync.mockReturnValue(settingsJson({ command: "/onetool" }));

    const result = resolveConnection();
    expect(result.args).toEqual([]);
  });

  it("throws a clear error when nothing is configured", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveConnection()).toThrow(/onetool\.command/);
  });
});
