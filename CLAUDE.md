Read dev/agents/hints.md for quick reference (commands, rules, project structure).

## Commands

Use `just` (not `make`) for project commands:

```bash
just          # install, typecheck, test
just test     # run tests
just build    # compile TypeScript
just typecheck # type-check without emitting
```

## No Backward Compatibility

**Never add backward-compatible fallbacks unless explicitly asked.**

- Removed API values, parameter names, or config keys must raise a clear error — not silently work
- No aliases, shims, or "treat old value as new value" logic
- When something is renamed or removed, delete it — do not keep the old name working

## Testing Constraints

- Never use `example.com` in tests or examples — it does not exist.

## OpenSpec Workflow

Use `/opsx:new` for changes that define new user-facing behaviour or modify existing contracts:

✅ Requires OpenSpec:
- Changes to the `ot` tool interface or description
- New Pi commands (e.g. `/ot <subcommand>`)
- Changes to config resolution logic
- Changes to MCP connection or reconnection behaviour

❌ No OpenSpec needed:
- Bug fixes and correctness improvements
- Adding or improving tests
- Internal refactors with no behaviour change
- Documentation updates
- Build/tooling changes
