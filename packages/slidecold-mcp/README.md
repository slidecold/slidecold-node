# slidecold-mcp

Official [MCP](https://modelcontextprotocol.io) server for [SlideCold](https://slidecold.com). It exposes all 49 SlideCold API operations as tools (`list_campaigns`, `get_campaign_stats`, `send_conversation_reply`, ...) over stdio. Node.js 18+.

Create an API key (`cs_...`) at <https://slidecold.com/settings>. Give the server only the scopes you want the assistant to have; a read-only key is a good start.

**Claude Code**

```sh
claude mcp add slidecold -e SLIDECOLD_API_KEY=cs_... -- npx -y slidecold-mcp
```

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "slidecold": {
      "command": "npx",
      "args": ["-y", "slidecold-mcp"],
      "env": { "SLIDECOLD_API_KEY": "cs_..." }
    }
  }
}
```

The key comes from `SLIDECOLD_API_KEY`, then the config file written by `npx slidecold login`. `SLIDECOLD_BASE_URL` overrides the API URL.

Each tool's description names the API key scope it needs. Tools are annotated read-only (GET), destructive (deletes and sending DMs) and idempotent. Upload tools (`send_conversation_photo`, `import_audience_members`) take a local `file_path`. API errors come back as tool errors with the API's message.

More: <https://github.com/slidecold/slidecold-node>.

## License

MIT
