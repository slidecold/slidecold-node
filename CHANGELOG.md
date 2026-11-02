# Changelog

All notable changes to the `slidecold` npm package are documented here.

## [0.2.0] - 2026-11-02

### Removed

- The Node.js `slidecold` CLI (the `bin` entry). The SlideCold CLI is now a single Go binary: <https://github.com/slidecold/slidecold-cli>. It writes the same config file (`~/.config/slidecold/config.json`), which this SDK still reads.
- The `slidecold-mcp` package moved to its own repository: <https://github.com/slidecold/slidecold-mcp>.

### Changed

- This repository is now a single package at the root (no npm workspaces). The SDK API is unchanged.

## [0.1.0] - 2026-11-02

### Added

- `slidecold`: typed Node.js SDK for all 49 SlideCold API v1 operations, generated from `openapi.yaml`.
- `slidecold`: typed errors (`AuthenticationError`, `PermissionError`, `NotFoundError`, `RateLimitError`, `APIError`, `APIConnectionError`), GET retries with exponential backoff, timeouts.
- `slidecold`: `waitForLoginJob()` and `verifyWebhookSignature()` helpers.
- `slidecold` CLI: `slidecold <resource> <action>` for every operation, plus `login`, `logout` and `help`.
- `slidecold-mcp`: stdio MCP server exposing every operation as a tool.
