# Changelog

All notable changes to `slidecold` and `slidecold-mcp` are documented here. Both packages share one version.

## [0.1.0] - 2026-11-02

### Added

- `slidecold`: typed Node.js SDK for all 49 SlideCold API v1 operations, generated from `openapi.yaml`.
- `slidecold`: typed errors (`AuthenticationError`, `PermissionError`, `NotFoundError`, `RateLimitError`, `APIError`, `APIConnectionError`), GET retries with exponential backoff, timeouts.
- `slidecold`: `waitForLoginJob()` and `verifyWebhookSignature()` helpers.
- `slidecold` CLI: `slidecold <resource> <action>` for every operation, plus `login`, `logout` and `help`.
- `slidecold-mcp`: stdio MCP server exposing every operation as a tool.
