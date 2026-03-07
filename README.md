# onetool-pi

Pi coding agent extension that bridges Pi and [onetool](https://github.com/beycom/onetool-mcp)'s 100+ tools via a single `ot` tool.

## Prerequisites

- [onetool](https://github.com/beycom/onetool-mcp) installed and configured (`onetool init`)
- Pi coding agent (`@mariozechner/pi-coding-agent`)

## Installation

```bash
npm pack
pi install-extension onetool-pi-*.tgz
```

## Configuration

Add an `onetool` block to `.pi/settings.json` (project) or `~/.pi/agent/settings.json` (global):

```json
{
  "onetool": {
    "command": "onetool",
    "args": ["serve"]
  }
}
```

Project settings take priority over global settings.

**Optional settings:**

| Key | Default | Description |
| --- | ------- | ----------- |
| `connectTimeout` | `10000` | Connection timeout in ms |
| `maxBytes` | (onetool default) | Truncate output at this many bytes |
| `maxLines` | (onetool default) | Truncate output at this many lines |
| `previewLines` | `10` | Lines shown before "click to expand" |

## Usage

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
