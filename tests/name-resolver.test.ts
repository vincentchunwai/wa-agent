import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRoutingNames } from '../src/runtime/name-resolver.js';
import type { AgentConfig } from '../src/agent/types.js';

vi.mock('@ibrahimwithi/wu-cli', () => ({
  searchChats: vi.fn(),
  searchContacts: vi.fn(),
  AUTH_DIR: '/mock/auth',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: vi.fn() };
});

import { searchChats, searchContacts } from '@ibrahimwithi/wu-cli';
import { readFileSync } from 'fs';

const mockSearchChats = vi.mocked(searchChats);
const mockSearchContacts = vi.mocked(searchContacts);
const mockReadFileSync = vi.mocked(readFileSync);

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'test-agent',
    llm: { provider: 'anthropic', model: 'test' },
    personality: 'test',
    tools: [],
    routing: [{ type: 'default', match: '*' }],
    memory: { conversationWindow: 20, userProfiles: true },
    ...overrides,
  } as AgentConfig;
}

describe('resolveRoutingNames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves JID matches unchanged (passthrough)', () => {
    const config = makeConfig({
      routing: [{ type: 'group', match: '120363xxx@g.us' }],
    });

    const result = resolveRoutingNames([config]);

    expect(mockSearchChats).not.toHaveBeenCalled();
    expect(config.routing[0].match).toBe('120363xxx@g.us');
    expect(result.resolved).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it('resolves group name to JID', () => {
    mockSearchChats.mockReturnValue([
      { jid: '120363abc@g.us', name: 'Team Chat', type: 'group', participant_count: 5, description: null, last_message_at: 1000, updated_at: 1000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'group', match: 'Team Chat' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('120363abc@g.us');
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toHaveLength(0);
  });

  it('resolves contact name to JID', () => {
    mockSearchContacts.mockReturnValue([
      { jid: '1234567890@s.whatsapp.net', phone: '+1234567890', push_name: 'John', saved_name: 'John Doe', is_business: 0, updated_at: 1000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'jid', match: 'John Doe' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('1234567890@s.whatsapp.net');
    expect(result.resolved).toBe(1);
  });

  it('picks exact name match for ambiguous groups', () => {
    mockSearchChats.mockReturnValue([
      { jid: '111@g.us', name: 'Team Chat (old)', type: 'group', participant_count: 3, description: null, last_message_at: 2000, updated_at: 2000 },
      { jid: '222@g.us', name: 'Team Chat', type: 'group', participant_count: 5, description: null, last_message_at: 1000, updated_at: 1000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'group', match: 'Team Chat' }],
    });

    resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('222@g.us');
  });

  it('prefers saved_name for ambiguous contacts', () => {
    mockSearchContacts.mockReturnValue([
      { jid: '111@s.whatsapp.net', phone: '+111', push_name: 'John', saved_name: null, is_business: 0, updated_at: 1000 },
      { jid: '222@s.whatsapp.net', phone: '+222', push_name: 'Johnny', saved_name: 'John', is_business: 0, updated_at: 1000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'jid', match: 'John' }],
    });

    resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('222@s.whatsapp.net');
  });

  it('unresolved name stays unchanged and appears in result', () => {
    mockSearchChats.mockReturnValue([]);

    const config = makeConfig({
      routing: [{ type: 'group', match: 'Nonexistent Group' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('Nonexistent Group');
    expect(result.unresolved).toContain('Nonexistent Group');
    expect(result.resolved).toBe(0);
  });

  it('resolves handoff.escalateTo', () => {
    mockSearchChats.mockReturnValue([
      { jid: '999@g.us', name: 'Support Team', type: 'group', participant_count: 10, description: null, last_message_at: 1000, updated_at: 1000 },
    ]);

    const config = makeConfig({
      handoff: { enabled: true, escalateTo: 'Support Team' },
    });

    const result = resolveRoutingNames([config]);

    expect(config.handoff!.escalateTo).toBe('999@g.us');
    expect(result.resolved).toBe(1);
  });

  it('resolves trigger targets', () => {
    mockSearchChats.mockReturnValue([]);
    mockSearchContacts.mockReturnValue([
      { jid: '555@s.whatsapp.net', phone: '+555', push_name: 'Boss', saved_name: 'Boss', is_business: 0, updated_at: 1000 },
    ]);

    const config = makeConfig({
      triggers: [{ type: 'cron', schedule: '0 9 * * *', action: 'send_report', target: 'Boss' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.triggers![0].target).toBe('555@s.whatsapp.net');
    expect(result.resolved).toBe(1);
  });

  it('skips keyword and default routing types', () => {
    const config = makeConfig({
      routing: [
        { type: 'keyword', match: 'help' },
        { type: 'default', match: '*' },
      ],
    });

    resolveRoutingNames([config]);

    expect(mockSearchChats).not.toHaveBeenCalled();
    expect(mockSearchContacts).not.toHaveBeenCalled();
    expect(config.routing[0].match).toBe('help');
    expect(config.routing[1].match).toBe('*');
  });

  it('falls back to most recently active group when no exact match', () => {
    mockSearchChats.mockReturnValue([
      { jid: '111@g.us', name: 'Dev Team 1', type: 'group', participant_count: 3, description: null, last_message_at: 500, updated_at: 500 },
      { jid: '222@g.us', name: 'Dev Team 2', type: 'group', participant_count: 5, description: null, last_message_at: 2000, updated_at: 2000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'group', match: 'Dev Team' }],
    });

    resolveRoutingNames([config]);

    // No exact match, so picks most recently active
    expect(config.routing[0].match).toBe('222@g.us');
  });

  it('filters out non-group chats for group routing', () => {
    mockSearchChats.mockReturnValue([
      { jid: '111@s.whatsapp.net', name: 'Team Chat', type: 'individual', participant_count: null, description: null, last_message_at: 2000, updated_at: 2000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'group', match: 'Team Chat' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('Team Chat');
    expect(result.unresolved).toContain('Team Chat');
  });

  // --- Phone-to-LID resolution tests ---

  it('resolves @s.whatsapp.net JID to @lid via mapping file', () => {
    mockReadFileSync.mockReturnValue('"999888777"');

    const config = makeConfig({
      routing: [{ type: 'jid', match: '85252054066@s.whatsapp.net' }],
    });

    const result = resolveRoutingNames([config]);

    expect(mockReadFileSync).toHaveBeenCalledWith('/mock/auth/lid-mapping-85252054066.json', 'utf-8');
    expect(config.routing[0].match).toBe('999888777@lid');
    expect(result.resolved).toBe(1);
  });

  it('resolves bare phone number to @lid', () => {
    mockReadFileSync.mockReturnValue('"111222333"');

    const config = makeConfig({
      routing: [{ type: 'jid', match: '85252054066' }],
    });

    const result = resolveRoutingNames([config]);

    expect(mockReadFileSync).toHaveBeenCalledWith('/mock/auth/lid-mapping-85252054066.json', 'utf-8');
    expect(config.routing[0].match).toBe('111222333@lid');
    expect(result.resolved).toBe(1);
  });

  it('resolves +prefixed phone number to @lid', () => {
    mockReadFileSync.mockReturnValue('"444555666"');

    const config = makeConfig({
      routing: [{ type: 'jid', match: '+85252054066' }],
    });

    const result = resolveRoutingNames([config]);

    expect(mockReadFileSync).toHaveBeenCalledWith('/mock/auth/lid-mapping-85252054066.json', 'utf-8');
    expect(config.routing[0].match).toBe('444555666@lid');
    expect(result.resolved).toBe(1);
  });

  it('falls through to name resolution when phone mapping not found', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockSearchContacts.mockReturnValue([
      { jid: '123@s.whatsapp.net', phone: '+123', push_name: 'John', saved_name: null, is_business: 0, updated_at: 1000 },
    ]);

    const config = makeConfig({
      routing: [{ type: 'jid', match: 'John' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('123@s.whatsapp.net');
    expect(result.resolved).toBe(1);
  });

  it('leaves @lid JIDs unchanged', () => {
    const config = makeConfig({
      routing: [{ type: 'jid', match: '208314688344081@lid' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('208314688344081@lid');
    expect(result.resolved).toBe(0);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('leaves @g.us JIDs unchanged', () => {
    const config = makeConfig({
      routing: [{ type: 'group', match: '120363xxx@g.us' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.routing[0].match).toBe('120363xxx@g.us');
    expect(result.resolved).toBe(0);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('resolves phone in handoff.escalateTo', () => {
    mockReadFileSync.mockReturnValue('"777888999"');

    const config = makeConfig({
      handoff: { enabled: true, escalateTo: '85252054066@s.whatsapp.net' },
    });

    const result = resolveRoutingNames([config]);

    expect(config.handoff!.escalateTo).toBe('777888999@lid');
    expect(result.resolved).toBe(1);
  });

  it('resolves phone in trigger target', () => {
    mockReadFileSync.mockReturnValue('"111000222"');

    const config = makeConfig({
      triggers: [{ type: 'cron', schedule: '0 9 * * *', action: 'send_report', target: '+85252054066' }],
    });

    const result = resolveRoutingNames([config]);

    expect(config.triggers![0].target).toBe('111000222@lid');
    expect(result.resolved).toBe(1);
  });
});
