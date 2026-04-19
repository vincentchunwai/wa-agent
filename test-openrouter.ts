import { createModel } from './src/agent/factory.js';
import { generateText } from 'ai';

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY env var is required');
    process.exit(1);
  }

  console.log('Creating OpenRouter model...');
  const model = createModel({
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4-20250514',
    apiKey,
  });

  console.log('Sending test request...');
  const result = await generateText({
    model,
    messages: [{ role: 'user', content: 'Say "OpenRouter works!" and nothing else.' }],
    maxOutputTokens: 20,
  });

  console.log('Response:', result.text);
  console.log('✓ OpenRouter integration verified');
}

main().catch((err) => {
  console.error('✗ Test failed:', err.message ?? err);
  process.exit(1);
});
