/**
 * Tool Registry — Registers all extracted tools with the MCP server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAgentTool, getAgentStatusTool, stopAgentTool, spawnAgentSessionTool } from './tools/agent-tools';
import { voiceSpeechTool } from './tools/voice-tools';
import { generateImageTool } from './tools/image-tools';

/**
 * Register all non-stub tools with the MCP server
 */
export function registerExtractedTools(server: McpServer): void {
  // ─── Agent Management ────────────────────────────────────────────────
  const createAgent = createAgentTool();
  server.tool(createAgent.name, createAgent.description, createAgent.inputSchema, createAgent.execute as any);

  const getAgentStatus = getAgentStatusTool();
  server.tool(getAgentStatus.name, getAgentStatus.description, getAgentStatus.inputSchema, getAgentStatus.execute as any);

  const stopAgent = stopAgentTool();
  server.tool(stopAgent.name, stopAgent.description, stopAgent.inputSchema, stopAgent.execute as any);

  const spawnAgentSession = spawnAgentSessionTool();
  server.tool(spawnAgentSession.name, spawnAgentSession.description, spawnAgentSession.inputSchema, spawnAgentSession.execute as any);

  // ─── Voice / TTS ─────────────────────────────────────────────────────
  const voiceSpeech = voiceSpeechTool();
  server.tool(voiceSpeech.name, voiceSpeech.description, voiceSpeech.inputSchema, voiceSpeech.execute as any);

  // ─── Image Generation ────────────────────────────────────────────────
  const generateImage = generateImageTool();
  server.tool(generateImage.name, generateImage.description, generateImage.inputSchema, generateImage.execute as any);
}
