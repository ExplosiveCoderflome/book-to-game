import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Command } from '../../app/commands/index.js';
import { errorResponse } from '../errors.js';

function createServer(commands: Command[]) {
  const server = new McpServer({name: 'novel-game-workbench', version: '0.1.0'});
  for (const command of commands) {
    server.registerTool(command.name, {
      description: command.description, inputSchema: command.inputSchema,
      annotations: {readOnlyHint: command.readOnly, destructiveHint: false,
        openWorldHint: ['create_generation_job', 'retry_job', 'test_model_connection'].includes(command.name)},
    }, async input => {
      try {
        const result = await command.execute(input);
        return {content: [{type: 'text' as const, text: JSON.stringify(result)}], structuredContent: {result}};
      } catch (error) {
        const response = errorResponse(error);
        return {isError: true, content: [{type: 'text' as const, text: JSON.stringify(response.body)}], structuredContent: response.body};
      }
    });
  }
  return server;
}
export function mcpRouter(commands: Command[]) {
  const router = Router();
  router.post('/', async (req, res, next) => {
    const server = createServer(commands);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    // Transport has no durable state. Tasks and game sessions live in application SQLite.
    res.on('close', () => {void transport.close(); void server.close();});
    try {await server.connect(transport); await transport.handleRequest(req, res, req.body);}
    catch (error) {if (!res.headersSent) next(error);}
  });
  router.all('/', (_req, res) => {res.setHeader('Allow', 'POST'); res.status(405).json({error: {code: 'METHOD_NOT_ALLOWED', message: '此无状态 MCP 端点使用 POST；业务任务通过 get_job 恢复'}});});
  return router;
}
