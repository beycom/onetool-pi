# onetool-pi Specification

Pi coding agent extension that bridges Pi and onetool's MCP server via a single `ot` tool.

## Requirements

### Requirement: Single `ot` tool registered with Pi
The extension SHALL register exactly one Pi tool named `ot` that accepts a `command` parameter (string). The tool description SHALL teach the LLM to discover packs via `ot.packs()`, `ot.help(query='...')`, and `ot.tools(pattern='...')`. The description SHALL NOT hard-code or enumerate onetool's internal packs or tools.

#### Scenario: Tool appears in Pi's tool list
- **WHEN** the `onetool-pi` extension is loaded by Pi
- **THEN** exactly one tool named `ot` is registered with label "OneTool"

#### Scenario: Tool description enables discovery
- **WHEN** the LLM reads the `ot` tool description
- **THEN** it contains instructions for `ot.packs()`, `ot.help(query='...')`, and Python composition examples

### Requirement: MCP connection pre-warm
The extension SHALL initiate an MCP stdio connection to the `onetool` binary at load time (fire-and-forget). The first `ot` tool call SHALL await this pre-warm promise if still in flight. The subprocess's stderr SHALL be suppressed (`stderr: "ignore"`) so that server startup output does not appear in the pi terminal. If the pre-warm fails, the error SHALL be logged via `console.error`.

#### Scenario: Pre-warm on load
- **WHEN** the extension module is loaded
- **THEN** `getClient()` is called immediately before any tool call arrives

#### Scenario: Pre-warm failure is logged
- **WHEN** the pre-warm connection attempt fails
- **THEN** the error is logged via `console.error` with the message

#### Scenario: First call reuses pre-warmed connection
- **WHEN** the pre-warm has completed before the first `ot` call
- **THEN** the first call does not spawn a new onetool process

### Requirement: Concurrent connection dedup
The extension SHALL ensure that at most one onetool process is spawned, even under concurrent `ot` calls during connection establishment.

#### Scenario: Concurrent calls share one connection promise
- **WHEN** two `ot` calls arrive while `connectPromise` is in flight
- **THEN** both await the same promise and share the resulting client

### Requirement: Auto-reconnect on error
On any MCP call error, the extension SHALL reset `client` and `connectPromise` to `null` so the next `ot` call spawns a fresh onetool process. A failed `connectPromise` SHALL also self-clear via a `.catch` handler so that the next call retries rather than returning the cached rejection.

#### Scenario: Error resets connection state
- **WHEN** `callTool` throws an error
- **THEN** `client` is set to `null` and the error is returned as a text content block prefixed with "onetool error: "

#### Scenario: Next call reconnects
- **WHEN** a previous call failed and reset the client
- **THEN** the next `ot` call attempts a fresh MCP connection

#### Scenario: Failed connectPromise is cleared
- **WHEN** `getClient()` rejects (e.g. onetool not running)
- **THEN** `connectPromise` is set back to `null` so the next call creates a fresh attempt

### Requirement: Graceful shutdown on session end
The extension SHALL close the MCP client (killing the onetool process) when Pi emits a `session_shutdown` event.

#### Scenario: Session shutdown closes process
- **WHEN** Pi fires `session_shutdown`
- **THEN** `client.close()` is called and `client` is set to `null`

### Requirement: Config resolution order
The extension SHALL resolve onetool config from `.pi/settings.json` in the project directory first, then `~/.pi/agent/settings.json`. The settings object SHALL be read from the `onetool` key and SHALL support: `command` (string), `args` (string[]), `connectTimeout` (number, ms), `maxBytes` (number), `maxLines` (number).

#### Scenario: Project-level config takes priority
- **WHEN** both `$CWD/.pi/settings.json` and `~/.pi/agent/settings.json` contain `onetool.command`
- **THEN** the project-level config is used

#### Scenario: connectTimeout from settings
- **WHEN** `onetool.connectTimeout` is set in settings
- **THEN** connection attempts time out after that many milliseconds

#### Scenario: maxBytes and maxLines from settings
- **WHEN** `onetool.maxBytes` or `onetool.maxLines` is set in settings
- **THEN** those values override the framework defaults for output truncation

#### Scenario: previewLines from settings
- **WHEN** `onetool.previewLines` is set in settings
- **THEN** that value overrides the default collapsed preview line count (10)

### Requirement: Config not found error
If no `onetool.command` is configured at load time, the extension SHALL register a placeholder `ot` tool whose description and execute both surface the error message. No exception is thrown from the extension module.

#### Scenario: Unconfigured — placeholder tool registered
- **WHEN** no `onetool.command` is configured in `.pi/settings.json` (CWD or HOME)
- **THEN** an `ot` tool is registered with label "OneTool (not configured)"

#### Scenario: Placeholder tool returns error
- **WHEN** the placeholder `ot` tool is called
- **THEN** it returns a text block with the configuration error message

### Requirement: MCP content transformation
The extension SHALL transform onetool's MCP `content[]` array into Pi `ContentBlock[]`. Text items become `TextContent`; image items with `data` become `ImageContent`. An empty array returns `[{ type: "text", text: "(empty)" }]`. A non-array result falls back to `String()`.

#### Scenario: Text content passthrough
- **WHEN** onetool returns `[{ type: "text", text: "hello" }]`
- **THEN** Pi receives `[{ type: "text", text: "hello" }]`

#### Scenario: Image content passthrough
- **WHEN** onetool returns `[{ type: "image", data: "abc", mimeType: "image/png" }]`
- **THEN** Pi receives `[{ type: "image", data: "abc", mimeType: "image/png" }]`

#### Scenario: Empty content array
- **WHEN** onetool returns `{ content: [] }`
- **THEN** Pi receives `[{ type: "text", text: "(empty)" }]`

#### Scenario: Non-array fallback
- **WHEN** onetool returns a value with no `content` array
- **THEN** Pi receives `[{ type: "text", text: "<stringified value>" }]`

### Requirement: Output truncation
The extension SHALL apply `truncateTail` to each text `ContentBlock` before returning to Pi. Image blocks SHALL NOT be truncated. When truncation occurs, a sentinel notice SHALL be appended to the text so the LLM and user know output was clipped. The truncation limits SHALL be overridable via `maxBytes`/`maxLines` in settings.

#### Scenario: Long text is truncated
- **WHEN** a text block exceeds `maxBytes` or `maxLines` (defaulting to framework constants)
- **THEN** `truncateTail` clips it and Pi receives the clipped version

#### Scenario: Truncation warning appended
- **WHEN** a text block is truncated
- **THEN** the clipped text ends with `[output truncated — use ctx or pagination to retrieve the full result]`

#### Scenario: Image blocks are not truncated
- **WHEN** the result contains an image block
- **THEN** the image block is passed through unchanged

### Requirement: Server instructions injection
After a successful MCP connection, the extension SHALL cache the server's instructions string (from `client.getInstructions()`). The extension SHALL register a `before_agent_start` handler that appends those instructions to Pi's system prompt before each agent turn. The `## Available Packs` section SHALL be stripped from the instructions before injection to minimise token cost; all other sections (triggers, call rules, discovery, security, output behaviour) SHALL be preserved. If the server returns no instructions, the handler SHALL return without modifying the system prompt.

#### Scenario: Instructions injected into system prompt
- **WHEN** the server returns instructions and a new agent turn starts
- **THEN** the system prompt contains the server instructions appended under `## OneTool`

#### Scenario: Available Packs section stripped
- **WHEN** server instructions contain `## Available Packs` followed by a pack list
- **THEN** the injected text contains the section header and `Use \`ot.packs()\`` line but not the individual pack entries

#### Scenario: No instructions — system prompt unchanged
- **WHEN** the server returns `undefined` from `getInstructions()`
- **THEN** the system prompt is not modified

### Requirement: `/ot` command
The extension SHALL register a `/ot` Pi command supporting `restart` (default) and `status` subcommands. `restart` closes the current client, unconditionally resets `connectPromise` to `null`, and spawns a fresh connection. `status` reports connected/disconnected.

#### Scenario: `/ot restart` spawns fresh connection
- **WHEN** user types `/ot` or `/ot restart`
- **THEN** `connectPromise` is reset to `null`, the current client (if any) is closed, and `getClient()` is called to establish a new connection

#### Scenario: `/ot restart` heals after pre-warm failure
- **WHEN** pre-warm failed leaving `connectPromise` rejected and `client` null
- **THEN** `/ot restart` resets `connectPromise` and retries the connection

#### Scenario: `/ot status` reports state
- **WHEN** user types `/ot status`
- **THEN** Pi shows "onetool: connected" or "onetool: disconnected"

#### Scenario: `/ot` with unknown subcommand
- **WHEN** user types `/ot unknown`
- **THEN** Pi shows usage: "Usage: /ot [restart|status]"

### Requirement: Abort signal respect
If the `signal` passed to `execute` is already aborted when the call starts, the extension SHALL return immediately with "Cancelled" without calling onetool. For in-flight calls, `signal` SHALL be forwarded to `callTool` so that cancellation propagates to the MCP layer.

#### Scenario: Pre-aborted signal short-circuits call
- **WHEN** `execute` is called with `signal.aborted === true`
- **THEN** the function returns `{ content: [{ type: "text", text: "Cancelled" }], details: {} }` immediately

#### Scenario: Signal forwarded to callTool
- **WHEN** `execute` starts a `callTool` call
- **THEN** the `signal` is passed as the abort signal to `callTool` so in-flight requests can be cancelled

### Requirement: Render output

The extension renders both the tool call input and its result. The tool call (`renderCall`) SHALL display as `🧿 <command>` using the `Markdown` component. The extension renders tool results as Markdown. JSON objects and arrays are serialised in block YAML style (not inline flow). A JSON value that is a plain string is rendered directly without a YAML fence. Image content blocks are rendered as `[image: <mimeType>]` placeholder text.

#### Scenario: Collapsed preview for long results
- **WHEN** `renderResult` is called with `options.expanded === false` and the display string exceeds `previewLines` lines
- **THEN** only the first `previewLines` lines are shown, followed by `… N more lines — click to expand`

#### Scenario: Expanded shows full result
- **WHEN** `renderResult` is called with `options.expanded === true`
- **THEN** the full display string is rendered

#### Scenario: Plain string value is not fenced
- **WHEN** onetool returns a JSON-encoded string (e.g. `"hello"`)
- **THEN** the display string is `hello`, not wrapped in ` ```yaml `

#### Scenario: Object rendered as block YAML
- **WHEN** onetool returns a JSON object
- **THEN** the display string contains block-style YAML with keys on separate lines

#### Scenario: Image block rendered as placeholder
- **WHEN** onetool returns an image content block with `mimeType: "image/jpeg"`
- **THEN** the display string contains `[image: image/jpeg]`

### Requirement: Connection timeout

Connection attempts SHALL time out after a configurable deadline (default 10 000 ms). The timeout is set via `connectTimeout` in `onetool` settings.

#### Scenario: Connection times out
- **WHEN** `newClient.connect()` does not resolve within `connectTimeout` ms
- **THEN** `getClient()` rejects with an error containing "timed out"
