import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatCardPng } from '../src/card.js';

import {
  calculateCookieValues,
  conversationKeyForUpdate,
  createConversationScheduler,
  deriveApproxBakeTxStats,
  isCheckCommand,
  isHiddenStatsCommand,
  isHelpCommand,
  isValueCommand,
  renderHiddenStatsMessage,
  renderCheckReport,
  renderWelcomeMessage,
  renderValueReport,
  shouldProcessUpdate,
  shouldAcceptCheckIdentityMessage,
} from '../src/index.js';

test('calculates the value of 1,000 cookies from prize pool and cookie balance', () => {
  const [value] = calculateCookieValues({
    agent: { liveState: { gameplayCaps: { cookieScale: 10000 } } },
    season: { prizePool: '10000000000000000000', payoutStructureBps: null },
    bakeries: [{ name: 'Circle', cookieBalance: '50000000' }],
    ethUsd: 2000,
  });

  assert.equal(value.prizeEth, 5);
  assert.equal(value.cookies, 5000);
  assert.equal(value.ethPerThousandCookies, 1);
  assert.equal(value.usdPerThousandCookies, 2000);
});

test('renders a Telegram-safe report', () => {
  const report = renderValueReport({
    values: [{
      medal: '🥇',
      name: 'A&B Bakery',
      payoutBps: 5000,
      prizeEth: 5,
      prizeUsd: 10000,
      cookies: 5000,
      ethPerThousandCookies: 1,
      usdPerThousandCookies: 2000,
    }],
    season: { id: 4, isActive: true, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-04-10T10:00:00.000Z'),
  });

  assert.match(report, /A&amp;B Bakery/);
  assert.match(report, /1,000 🍪 = \$2,000/);
  assert.match(report, /Prize pool: 10 ETH/);
  assert.match(report, /Updated: 10 Apr 2026, 13:00:00 MSK/);
});

test('recognizes direct and group Telegram commands', () => {
  assert.equal(isHelpCommand('/start'), true);
  assert.equal(isHelpCommand('/help'), true);
  assert.equal(isValueCommand('/cookie'), true);
  assert.equal(isValueCommand('/cookies'), true);
  assert.equal(isValueCommand('/cookies@RugBot'), true);
  assert.equal(isValueCommand('/unknown'), false);
  assert.equal(isCheckCommand('/check'), false);
  assert.equal(isCheckCommand('/checkme'), false);
  assert.equal(isCheckCommand('/ch'), true);
  assert.equal(isCheckCommand('/ch@RugBot'), true);
  assert.equal(isCheckCommand('/ch arsii'), true);
  assert.equal(isCheckCommand('/cookies'), false);
  assert.equal(isHiddenStatsCommand('/statsss777'), true);
  assert.equal(isHiddenStatsCommand('/statsss777@RugBot'), true);
  assert.equal(isHiddenStatsCommand('/stats'), false);
});

test('builds a stable conversation key from chat and user', () => {
  const key = conversationKeyForUpdate({
    update_id: 42,
    message: {
      chat: { id: -100123 },
      from: { id: 777 },
    },
  });

  assert.equal(key, '-100123:777');
});

test('processes the same update id only once', () => {
  const update = { update_id: 12345, message: { chat: { id: 1 }, from: { id: 2 } } };
  assert.equal(shouldProcessUpdate(update), true);
  assert.equal(shouldProcessUpdate(update), false);
});

test('schedules different conversations in parallel while preserving same-conversation order', async () => {
  const scheduler = createConversationScheduler(2);
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = scheduler.schedule('chatA:user1', async () => {
    events.push('a1-start');
    await firstGate;
    events.push('a1-end');
  });

  const second = scheduler.schedule('chatA:user1', async () => {
    events.push('a2-start');
    events.push('a2-end');
  });

  const third = scheduler.schedule('chatB:user2', async () => {
    events.push('b1-start');
    events.push('b1-end');
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(events.includes('a1-start'));
  assert.ok(events.includes('b1-start'));
  assert.ok(!events.includes('a2-start'));

  releaseFirst();
  await Promise.all([first, second, third]);

  assert.ok(events.indexOf('a2-start') > events.indexOf('a1-end'));
  assert.ok(events.indexOf('b1-start') < events.indexOf('a1-end'));
});

test('accepts check identity input safely in groups', () => {
  const session = {
    awaitingIdentity: true,
    isGroup: true,
    promptMessageId: 777,
    createdAtMs: Date.now(),
  };

  assert.equal(shouldAcceptCheckIdentityMessage(session, {
    text: 'ARSii',
    reply_to_message: { message_id: 777 },
  }), true);

  assert.equal(shouldAcceptCheckIdentityMessage(session, {
    text: 'random chat message',
    reply_to_message: { message_id: 778 },
  }), false);

  assert.equal(shouldAcceptCheckIdentityMessage(session, {
    text: 'random chat message',
  }), false);
});

test('accepts check identity input freely in private chat', () => {
  const session = {
    awaitingIdentity: true,
    isGroup: false,
    createdAtMs: Date.now(),
  };

  assert.equal(shouldAcceptCheckIdentityMessage(session, {
    text: 'ARSii',
  }), true);
});

test('renders a welcome message with command descriptions', () => {
  const message = renderWelcomeMessage();

  assert.match(message, /\/cookie/);
  assert.match(message, /1,000 cookies/);
  assert.match(message, /\/ch/);
  assert.match(message, /profit\/loss/i);
  assert.doesNotMatch(message, /statsss777/i);
});

test('renders the hidden stats message', () => {
  const message = renderHiddenStatsMessage({
    privateUsers: 79,
    groupChats: 2,
    totalChats: 81,
  }, new Date('2026-04-12T10:00:00.000Z'));

  assert.match(message, /Users: <b>79<\/b>/);
  assert.match(message, /Groups: <b>2<\/b>/);
  assert.match(message, /Total chats: <b>81<\/b>/);
  assert.match(message, /Updated: 12 Apr 2026, 13:00:00 MSK/);
});

test('keeps tx count fresh when gas falls back to approximate mode', () => {
  const stats = deriveApproxBakeTxStats({
    transactionHashes: ['0x1', '0x2', '0x3'],
    cachedValue: {
      transactionHashes: ['0x1', '0x2'],
      gasSpentEth: 0.01,
      averageFeeEth: 0.005,
      source: 'on-chain-bake-receipts-exact',
    },
    averageFeeEth: 0.006,
  });

  assert.equal(stats.transactionCount, 3);
  assert.equal(stats.gasSpentEth, 0.016);
  assert.equal(stats.averageFeeEth, 0.006);
  assert.equal(stats.source, 'on-chain-bake-logs-approx-incremental');
});

test('renders a season check report', () => {
  const report = renderCheckReport({
    identity: 'skuznyak',
    profile: { name: 'skuznyak' },
    address: '0xfc2f66cb45b581e85e90fa9dc83a9e57fc98bd68',
    season: { id: 4, prizePool: '10000000000000000000' },
    seasonStartTime: 1775763633,
    bakery: { name: 'Abstract CIS' },
    bakeryValue: { ethPerThousandCookies: 0.0015 },
    member: { txCount: '470000000' },
    txCount: 13283,
    gasSpentEth: 0.08442,
    gasSpentUsd: 187,
    rewardEth: 0.1137,
    rewardUsd: 252,
    netEth: 0.02928,
    netUsd: 65,
    roiPercent: 34.6,
    ethUsd: 2200,
  });

  assert.match(report, /skuznyak/);
  assert.match(report, /Abstract CIS/);
  assert.match(report, /Cook tx: <b>13,283<\/b>/);
  assert.match(report, /Net ROI: <b>\+34.6%<\/b> \(\+\$65\)|Net ROI: <b>\+34.6%<\/b>\s*\(\+\$65\)/);
});

test('renders a png stat card buffer', async () => {
  const buffer = await renderStatCardPng({
    title: 'Season Check',
    name: 'ARSii',
    address: '0x984C...D83C',
    clan: 'Clan: Abstract CIS (top 5)',
    tiles: [
      { label: 'Cookies', value: '18.5K' },
      { label: 'Cook tx', value: '5,096' },
      { label: 'Gas cost', value: '0.03440 ETH', subvalue: '$77' },
      { label: 'Est reward', value: '0.0339 ETH', subvalue: '$76' },
      { label: 'Net ROI', value: '-1.4%', subvalue: '-$1' },
      { label: '1K value', value: '0.001834 ETH', subvalue: 'ETH/USD $2,231.91' },
    ],
    footerLines: [
      'Season started 2026-03-25T17:13:36.000Z',
      'Prize pool 18.3884 ETH',
      '1,000 cookies in Abstract CIS 0.001834 ETH',
      'ETH/USD $2,231.91',
    ],
  });

  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(buffer.length > 1000);
});
