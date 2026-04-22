# Security Policy

## Supported versions

Only the latest `1.x` release is actively supported.

## Reporting a vulnerability

If you find a security vulnerability in claude-video-vision, please **do not open a public issue**.

Instead, report it privately via [GitHub Security Advisories](https://github.com/jordanrendric/claude-video-vision/security/advisories/new).

Include:
- A description of the vulnerability
- Steps to reproduce
- The affected version
- Any suggested fix if you have one

I aim to respond within 7 days and issue a fix within 30 days for confirmed vulnerabilities.

## Scope

In scope:
- The MCP server code (`mcp-server/`)
- The plugin manifest and configuration
- The slash commands and skill

Out of scope:
- Issues in upstream dependencies (report to their maintainers)
- Issues specific to Claude Code itself
- Misconfiguration of user-provided API keys

## Sensitive data

This plugin handles:
- Video files provided by the user
- API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) from the environment
- Transcribed audio content

None of these are logged or transmitted except to the configured backend (local whisper, Gemini API, or OpenAI API).
