import { tool } from 'ai';
import { z } from 'zod';
import { sendText } from '@ibrahimwithi/wu-cli';
import { setHandoffState } from '../../memory/store.js';
import type { ToolContext } from '../types.js';

function getOwnJid(ctx: ToolContext): string | null {
  const user = (ctx.sock as any).user;
  if (!user?.id) return null;
  // Normalize: strip device suffix (e.g. "123:45@s.whatsapp.net" → "123@s.whatsapp.net")
  return user.id.replace(/:\d+@/, '@');
}

export function createHandoffTool(ctx: ToolContext) {
  const silent = ctx.agentConfig.handoff?.silent ?? false;

  const description = silent
    ? 'Hand off this conversation so it can be handled personally. Use when you cannot adequately help the user or when the situation requires a personal touch.'
    : 'Escalate the conversation to another team member. Use when the user needs additional assistance.';

  return tool({
    description,
    inputSchema: z.object({
      reason: z.string().describe('Reason for escalation'),
      summary: z.string().describe('Brief summary of the conversation so far'),
    }),
    execute: async ({ reason, summary }) => {
      let escalateTo = ctx.agentConfig.handoff?.escalateTo;
      if (!escalateTo) {
        return { handedOff: false, error: 'No handoff target configured' };
      }

      // Resolve 'self' to the bot's own JID
      if (escalateTo === 'self') {
        const ownJid = getOwnJid(ctx);
        if (!ownJid) {
          return { handedOff: false, error: 'Could not resolve own JID' };
        }
        escalateTo = ownJid;
      }

      // Mark chat as handed off
      setHandoffState(ctx.agentConfig.name, ctx.chatJid, true);

      // Notify the operator (send to self or escalation target)
      const notification = `🔔 *Handoff from ${ctx.agentConfig.name}*\n\n` +
        `*Chat:* ${ctx.chatJid}\n` +
        `*Reason:* ${reason}\n\n` +
        `*Summary:*\n${summary}\n\n` +
        `_Reply /done here to resolve this handoff._`;

      await sendText(ctx.sock, escalateTo, notification, ctx.config);

      return { handedOff: true, escalatedTo: escalateTo, reason };
    },
  });
}
