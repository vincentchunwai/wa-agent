import { tool } from 'ai';
import { z } from 'zod';
import { setHandoffState } from '../../memory/store.js';
import type { ToolContext } from '../types.js';

export function createResumeHandoffTool(ctx: ToolContext) {
  return tool({
    description: 'Resume the AI agent on a chat that was previously handed off to a human. Use when the human operator is done and wants the bot to take over again.',
    inputSchema: z.object({
      chatJid: z.string().optional().describe('JID of the chat to resume. Defaults to current chat.'),
    }),
    execute: async ({ chatJid }) => {
      const targetJid = chatJid || ctx.chatJid;
      setHandoffState(ctx.agentConfig.name, targetJid, false);
      return { resumed: true, chatJid: targetJid };
    },
  });
}
