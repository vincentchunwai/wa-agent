import { createModel } from './dist/agent/factory.js';
import { generateText } from 'ai';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY env var is required');
  process.exit(1);
}

// Test: multi-turn with tools (mirrors the real agent usage that was failing)
console.log('Test: multi-turn + tools via Chat Completions API...');
try {
  const model = createModel({
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1-0528',
    apiKey,
  });

  const result = await generateText({
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say "Chat Completions API works!" and nothing else.' },
    ],
    tools: {
      'send-message': {
        description: 'Send a message',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Message text' },
          },
        },
      },
    },
    maxOutputTokens: 50,
    temperature: 0.7,
  });

  console.log('Response:', result.text);
  console.log('PASSED - no more Responses API error');
} catch (err) {
  console.error('FAILED:', err.message);
  if (err.message.includes('Responses API')) {
    console.error('Still hitting Responses API - fix did not work');
  }
  process.exit(1);
}
