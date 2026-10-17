# FindYourDent

Dentistry platform for Indonesia, built for the AI Builder Cup 2026. Specs live in `docs/specs/`, decisions in `docs/adr/`, vocabulary in `GLOSSARY.md`.

Google Cloud project `findyourdent` (asia-southeast2): resources, secret names, quota caps and manual steps are in `infra/gcp/README.md`.

## Browser checks

Use the `chrome-devtools` MCP server (`.mcp.json`, isolated profile) for visual, Lighthouse and performance checks: screenshots at phone width, `lighthouse_audit`, performance traces, mobile network emulation, console and network errors. User journeys are proven only by Playwright specs in `apps/web/e2e/`, never by MCP clicking.

## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub Issues in ahmadwaliradhi/findyourdent (public), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root and ADRs in `docs/adr/`. See `docs/agents/domain.md`.
