# onetool-pi

![onetool-pi banner](https://raw.githubusercontent.com/beycom/onetool-pi/main/docs/assests/banner.png)

🧿 Pi coding agent extension — the ultimate MCP bridge with 100+ tools including Brave, Google, Context7, Excalidraw, AWS, Version Checker, Excel, File Ops, Database, Playwright, Chrome DevTools and many more.

[![npm](https://img.shields.io/npm/v/onetool-pi?label=npm)](https://www.npmjs.com/package/onetool-pi)
[![license](https://img.shields.io/npm/l/onetool-pi)](./LICENSE.txt)
[![node](https://img.shields.io/node/v/onetool-pi)](https://nodejs.org)

## Prerequisites

- [onetool](https://github.com/beycom/onetool-mcp) installed and configured (`onetool init`)
- [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) coding agent (`@mariozechner/pi-coding-agent`)

## Installation

```bash
pi install npm:onetool-pi
```

## Configuration

Add an `onetool` block to `.pi/settings.json` (project) or `~/.pi/settings.json` (global):

```json
{
  "onetool": {
    "command": "onetool",
    "args": [
      "--config", "~/.onetool/onetool.yaml",
      "--secrets", "~/.onetool/secrets.yaml"
    ]
  }
}
```

> Replace `~/.onetool/onetool.yaml` and `~/.onetool/secrets.yaml` with the paths to your own onetool config and secrets files.

Project settings take priority over global settings.

**Optional settings:**

| Key | Default | Description |
| --- | ------- | ----------- |
| `connectTimeout` | `10000` | Connection timeout in ms |
| `maxBytes` | (onetool default) | Truncate output at this many bytes |
| `maxLines` | (onetool default) | Truncate output at this many lines |
| `previewLines` | `10` | Lines shown before "click to expand" |


## Usage

For full documentation and available packs, visit [onetool.beycom.online](https://onetool.beycom.online/).

Once installed, the `ot` tool is available in Pi:

```python
# Install skills for Pi
ot_forge.install_skills(install='ot-ref', tool='pi')

# Discover available packs
ot.packs()

# Search for tools
ot.help(query='search')

# Web search
brave.search(query='latest AI news')

# Fetch a URL
wf.fetch(url='https://...')

# Chain results in one call
results = brave.search(query='fastapi'); ot_llm.transform(text=results, prompt='summarize')
```

## Commands

- `/ot` or `/ot restart` — restart the onetool connection
- `/ot status` — show connection status
