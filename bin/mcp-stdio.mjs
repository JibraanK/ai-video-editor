#!/usr/bin/env node
// stdio <-> Streamable HTTP bridge so stdio-only MCP clients can drive a running Cutline editor.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const url = new URL(process.env.CUTLINE_MCP_URL ?? 'http://127.0.0.1:47821/mcp')
const client = new Client({ name: 'cutline-stdio-bridge', version: '0.1.0' })
await client.connect(new StreamableHTTPClientTransport(url))

const server = new Server({ name: 'cutline', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: client.getInstructions?.() })
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools())
server.setRequestHandler(CallToolRequestSchema, (req) => client.callTool(req.params))
await server.connect(new StdioServerTransport())
