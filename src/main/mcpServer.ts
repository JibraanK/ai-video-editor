import http from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS, AGENT_SYSTEM_PROMPT } from '@shared/agentTools'
import { emit } from './bridge'
import { executeTool } from './tools'

let httpServer: http.Server | null = null
let activePort = 0

export function mcpUrl(port = activePort): string {
  return `http://127.0.0.1:${port}/mcp`
}

export function mcpStatus() {
  return { running: !!httpServer, port: activePort, url: httpServer ? mcpUrl() : null }
}

function buildServer(): Server {
  const server = new Server({ name: 'cutline', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: AGENT_SYSTEM_PROMPT })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as any })) }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    emit('agent:event', { source: 'mcp', type: 'tool', name, args })
    try {
      const result = await executeTool(name, args ?? {})
      emit('agent:event', { source: 'mcp', type: 'tool_result', name, ok: true })
      return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] }
    } catch (e) {
      emit('agent:event', { source: 'mcp', type: 'tool_result', name, ok: false, error: (e as Error).message })
      return { content: [{ type: 'text', text: (e as Error).message }], isError: true }
    }
  })
  return server
}

export async function startMcpServer(port: number): Promise<{ url: string }> {
  if (httpServer && activePort === port) return { url: mcpUrl() }
  await stopMcpServer()
  const srv = http.createServer(async (req, res) => {
    const origin = req.headers.origin
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.writeHead(403).end('Forbidden origin')
      return
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, name: 'cutline' }))
      return
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }))
      return
    }
    // Stateless mode: a fresh server/transport per request.
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`]
    })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(String(e))
    }
  })
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(port, '127.0.0.1', () => resolve())
  })
  httpServer = srv
  activePort = port
  return { url: mcpUrl() }
}

export async function stopMcpServer(): Promise<void> {
  if (!httpServer) return
  await new Promise<void>((r) => httpServer!.close(() => r()))
  httpServer = null
  activePort = 0
}
