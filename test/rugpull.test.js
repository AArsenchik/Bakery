import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatCardPng } from '../src/card.js';

import {
  abstractProfileOverridePngUrl,
  calculateDivisionPayoutBuckets,
  calculateGroupedScorePayout,
  calculateCookieValues,
  conversationKeyForUpdate,
  createConversationScheduler,
  detectPayoutModel,
  deriveApproxBakeTxStats,
  gasSpentEthFromTxStats,
  isCheckCommand,
  isCheckIndexFresh,
  isHiddenStatsCommand,
  isHelpCommand,
  isValueCommand,
  mainMenuInlineMarkup,
  renderHiddenStatsMessage,
  renderCheckReport,
  renderDivisionPayoutReport,
  renderGroupedScorePayoutReport,
  renderSoloPayoutReport,
  renderWelcomeMessage,
  renderValueReport,
  soloLeaderboardShareForRank,
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

test('returns the published leaderboard share for solo payout ranks', () => {
  assert.equal(soloLeaderboardShareForRank(1), 0.075);
  assert.equal(soloLeaderboardShareForRank(10), 0.017);
  assert.equal(soloLeaderboardShareForRank(12), 0.0147);
  assert.equal(soloLeaderboardShareForRank(37), 0.0088);
  assert.equal(soloLeaderboardShareForRank(88), 0.00424);
  assert.equal(soloLeaderboardShareForRank(101), 0);
});

test('renders a solo payout report for the current season', () => {
  const report = renderSoloPayoutReport({
    season: { id: 5, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-04-17T10:00:00.000Z'),
  });

  assert.match(report, /Current Season Payouts/);
  assert.match(report, /Leaderboard bucket \(70%\): 7 ETH/);
  assert.match(report, /Activity bucket \(30%\): 3 ETH/);
  assert.match(report, /#1: 7.5% of leaderboard bucket = 0.525 ETH/);
  assert.match(report, /#51-100: 0.424% of leaderboard bucket = 0.02968 ETH/);
  assert.match(report, /tier sizes are not disclosed/i);
});

test('calculates season 4 division payout buckets', () => {
  const payouts = calculateDivisionPayoutBuckets({
    season: { id: 6, prizePool: '10000000000000000000' },
    ethUsd: 2000,
  });

  assert.equal(payouts.standardLeaderboardBucketEth, 2.5);
  assert.equal(payouts.standardActivityBucketEth, 3.5);
  assert.equal(payouts.openLeaderboardBucketEth, 4);
  assert.equal(payouts.standardLeaderboardRows[4].rewardEth, 0.04);
  assert.equal(payouts.openLeaderboardRows[10].rewardEth, 0.0896);
});

test('renders a division payout report for season 4', () => {
  const report = renderDivisionPayoutReport({
    season: { id: 6, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-04-25T08:00:00.000Z'),
  });

  assert.match(report, /Standard leaderboard bucket \(25%\): 2.5 ETH/);
  assert.match(report, /Standard activity bucket \(35%\): 3.5 ETH/);
  assert.match(report, /Open leaderboard bucket \(40%\): 4 ETH/);
  assert.match(report, /#4-10: 3.2% of Standard leaderboard bucket = 0.08 ETH/);
  assert.match(report, /Tier A: 50% of Standard activity bucket = 1.75 ETH/);
  assert.match(report, /#11-25: 2.24% of Open leaderboard bucket = 0.0896 ETH/);
  assert.match(report, /Score scales \+5% per day/);
});

test('calculates season 5 grouped score-weighted payout', () => {
  const payout = calculateGroupedScorePayout({
    season: { id: 7, prizePool: '10000000000000000000' },
    topBakeries: [
      { id: 1, rank: 1, score: '600000000' },
      { id: 2, rank: 2, score: '400000000' },
    ],
    bakery: { id: 1, rank: 1, score: '600000000' },
    member: { address: '0x1', score: '150000000' },
    ethUsd: 2000,
  });

  assert.equal(payout.rewardEth, 1.5);
  assert.equal(payout.rewardUsd, 3000);
  assert.equal(payout.bakeryShare, 0.6);
  assert.equal(payout.memberShare, 0.25);
});

test('renders a grouped score payout report for season 5', () => {
  const report = renderGroupedScorePayoutReport({
    season: { id: 7, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-05-08T10:00:00.000Z'),
  });

  assert.match(report, /Placement pool \(100%\): 10 ETH/);
  assert.match(report, /Top 10 bakeries qualify by final score/);
  assert.match(report, /Bakery payout = bakery score \/ top-10 total score \* placement pool/);
  assert.match(report, /Bakery cap: 50 members/);
});

test('renders a grouped score payout report for season 8 top-7 config', () => {
  const report = renderGroupedScorePayoutReport({
    agent: {
      liveState: {
        marketingSeason: 8,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [
            { tierId: 1, name: 'Grouped', enabled: true, bakeCooldownBlocks: 5 },
            { tierId: 2, name: 'Open', enabled: true, bakeCooldownBlocks: 1 },
          ],
        },
      },
      coreMechanics: {
        leaderboardsAndPayouts: {
          scoreFormula: 'score = cookiesBaked * 1.00 for all projected bakes. There is no daily score scaler in Season 8.',
          scoreSharePlacementPool: {
            marketingSeason: 8,
            prizePoolShareBps: 10000,
            qualifiedBakeryCount: 7,
            fixedRankPercentages: false,
          },
        },
      },
    },
    season: { id: 10, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-06-10T10:00:00.000Z'),
  });

  assert.match(report, /Season 8 payout/);
  assert.match(report, /Top 7 bakeries qualify by final score/);
  assert.match(report, /top-7 total score \* placement pool/);
  assert.match(report, /Season 8 uses top-7 score-share placement payouts/);
});

test('uses season 8 top-7 grouped score fallback when agent data is missing', () => {
  const report = renderGroupedScorePayoutReport({
    season: { id: 10, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-06-11T10:00:00.000Z'),
  });

  assert.match(report, /Season 8 payout/);
  assert.match(report, /Top 7 bakeries qualify by final score/);
  assert.match(report, /Bakery payout = bakery score \/ top-7 total score \* placement pool/);
});

test('renders a grouped score payout report for season 6', () => {
  const report = renderGroupedScorePayoutReport({
    agent: {
      liveState: {
        marketingSeason: 6,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [
            { tierId: 1, name: 'Grouped', enabled: true, bakeCooldownBlocks: 5 },
            { tierId: 2, name: 'Open', enabled: true, bakeCooldownBlocks: 1 },
          ],
        },
      },
      coreMechanics: {
        bakeryCreation: {
          season6Docs: { memberCap: 50, bakeCooldownBlocks: 5 },
        },
        leaderboardsAndPayouts: {
          scoreSharePlacementPool: {
            marketingSeason: 6,
            qualifiedBakeryCount: 10,
            fixedRankPercentages: false,
          },
        },
        bakeryUpgrades: {
          upgradeDefinitions: [
            { name: 'Upgraded Oven' },
            { name: 'Propaganda Office' },
          ],
        },
        randomEvents: {
          eventPool: [
            { name: 'Rush Order', multiplierBps: 11000, durationSeconds: 3600 },
            { name: 'Golden Batch', multiplierBps: 12000, durationSeconds: 2700 },
          ],
        },
      },
    },
    season: { id: 8, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-05-18T10:00:00.000Z'),
  });

  assert.match(report, /Season 6 payout/);
  assert.match(report, /Grouped: 50 members, 1 bake per baker every 5 blocks/);
  assert.match(report, /Open: solo bakery, 1 bake per baker every 1 block/);
  assert.match(report, /global score-share top 10/);
  assert.match(report, /Auto-bake/);
  assert.match(report, /Upgrade paths: Upgraded Oven, Propaganda Office/);
  assert.match(report, /Random events: Rush Order \+10%\/60m; Golden Batch \+20%\/45m/);
});

test('renders a grouped score payout report for season 7 without daily score scaler', () => {
  const report = renderGroupedScorePayoutReport({
    agent: {
      liveState: {
        marketingSeason: 7,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [
            { tierId: 1, name: 'Grouped', enabled: true, bakeCooldownBlocks: 5 },
            { tierId: 2, name: 'Open', enabled: true, bakeCooldownBlocks: 1 },
          ],
        },
      },
      coreMechanics: {
        leaderboardsAndPayouts: {
          scoreFormula: 'score = cookiesBaked * 1.00 for newly projected bakes; no daily score scaler is applied.',
          scoreSharePlacementPool: {
            marketingSeason: 7,
            prizePoolShareBps: 10000,
            qualifiedBakeryCount: 10,
            fixedRankPercentages: false,
          },
        },
        bakeryUpgrades: {
          upgradeDefinitions: [
            { name: 'Upgraded Oven' },
            { name: 'Propaganda Office' },
          ],
        },
        randomEvents: {
          eventPool: [
            { name: 'Rush Order', multiplierBps: 11000, durationSeconds: 3600 },
          ],
        },
      },
    },
    season: { id: 9, prizePool: '10000000000000000000' },
    ethUsd: 2000,
    generatedAt: new Date('2026-05-28T10:00:00.000Z'),
  });

  assert.match(report, /Season 7 payout/);
  assert.match(report, /Score = cookies baked \* 1\.00/);
  assert.doesNotMatch(report, /grows \+5% per season day/);
  assert.match(report, /Player skills can change gameplay output/);
  assert.match(report, /Ecosystem reward drawings are separate from the ETH prize pool/);
});

test('prefers division payout model over solo fallback for season 4-style data', () => {
  const payoutModel = detectPayoutModel(
    { liveState: { gameplayCaps: { cookieScale: 10000 } } },
    { id: 6 },
    [{ id: 123, memberCount: 1 }],
  );

  assert.equal(payoutModel, 'division-standard-open');
});

test('prefers grouped score payout model for season 5 live data', () => {
  const payoutModel = detectPayoutModel(
    {
      liveState: {
        marketingSeason: 5,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [{ tierId: 1, name: 'Grouped', enabled: true }],
        },
      },
      coreMechanics: {
        leaderboardsAndPayouts: {
          season5PlacementPool: { qualifiedBakeryCount: 10 },
        },
      },
    },
    { id: 7 },
    [{ id: 123, memberCount: 23, tierId: 1, score: '0' }],
  );

  assert.equal(payoutModel, 'grouped-score-top10');
});

test('prefers grouped score payout model for season 6 live data', () => {
  const payoutModel = detectPayoutModel(
    {
      liveState: {
        marketingSeason: 6,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [
            { tierId: 1, name: 'Grouped', enabled: true, bakeCooldownBlocks: 5 },
            { tierId: 2, name: 'Open', enabled: true, bakeCooldownBlocks: 1 },
          ],
        },
      },
      coreMechanics: {
        leaderboardsAndPayouts: {
          scoreSharePlacementPool: { marketingSeason: 6, qualifiedBakeryCount: 10 },
        },
      },
    },
    { id: 8 },
    [{ id: 123, memberCount: 34, tierId: 1, score: '0' }],
  );

  assert.equal(payoutModel, 'grouped-score-top10');
});

test('prefers grouped score payout model for season 7 live data', () => {
  const payoutModel = detectPayoutModel(
    {
      liveState: {
        marketingSeason: 7,
        gameplayCaps: {
          clanMemberCap: 50,
          bakeryTiers: [
            { tierId: 1, name: 'Grouped', enabled: true, bakeCooldownBlocks: 5 },
            { tierId: 2, name: 'Open', enabled: true, bakeCooldownBlocks: 1 },
          ],
        },
      },
      coreMechanics: {
        leaderboardsAndPayouts: {
          scoreSharePlacementPool: { marketingSeason: 7, qualifiedBakeryCount: 10 },
        },
      },
    },
    { id: 9 },
    [{ id: 123, memberCount: 34, tierId: 1, score: '0' }],
  );

  assert.equal(payoutModel, 'grouped-score-top10');
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

test('treats stale check indexes as not fresh', () => {
  const now = Date.now();
  assert.equal(isCheckIndexFresh({ generatedAtMs: now - 1_000 }, now), true);
  assert.equal(isCheckIndexFresh({ generatedAtMs: now - 31_000 }, now), false);
  assert.equal(isCheckIndexFresh(null, now), false);
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
  assert.match(message, /reward breakdown/i);
  assert.match(message, /\/ch/);
  assert.match(message, /profit\/loss/i);
  assert.match(message, /My stats/i);
  assert.doesNotMatch(message, /statsss777/i);
});

test('builds an inline menu with saved account actions', () => {
  const markup = mainMenuInlineMarkup();
  const labels = markup.inline_keyboard.flat().map((button) => button.text);
  const callbackData = markup.inline_keyboard.flat().map((button) => button.callback_data);

  assert.ok(labels.includes('📊 My stats'));
  assert.ok(labels.includes('🔎 Check player'));
  assert.ok(labels.includes('🍪 Rewards'));
  assert.ok(labels.includes('💾 Save account'));
  assert.ok(labels.includes('🗑 Forget account'));
  assert.ok(callbackData.every(Boolean));
});

test('builds Abstract profile override avatar URLs', () => {
  assert.equal(
    abstractProfileOverridePngUrl('266838'),
    'https://abstract-assets.abs.xyz/avatars/profile_override/266838.png',
  );
  assert.equal(abstractProfileOverridePngUrl(''), null);
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

test('does not invent gas cost when exact fees are unavailable', () => {
  assert.equal(gasSpentEthFromTxStats({
    transactionCount: 120,
    gasSpentEth: null,
    averageFeeEth: null,
    source: 'on-chain-bake-logs-fees-unavailable',
  }), null);

  assert.equal(gasSpentEthFromTxStats({
    transactionCount: 120,
    gasSpentEth: 0.00123,
    averageFeeEth: 0.00001025,
    source: 'on-chain-bake-fees-exact',
  }), 0.00123);
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

test('renders a solo season check report with leaderboard-specific wording', () => {
  const report = renderCheckReport({
    identity: 'notblairbear',
    profile: { name: 'notblairbear' },
    address: '0xa0eaaeb2c46d4a0fac8d4566de9d4fd834bf0a44',
    payoutModel: 'solo-leaderboard-activity',
    season: { id: 5, prizePool: '10000000000000000000' },
    seasonStartTime: 1776434427,
    bakery: { name: 'notblairbear' },
    bakeryValue: null,
    member: { txCount: '54000000', bakedTxCount: '88000000', rank: 77 },
    txCount: 3428,
    gasSpentEth: 0.02012,
    gasSpentUsd: 49,
    rewardEth: 0.02968,
    rewardUsd: 73,
    netEth: 0.00956,
    netUsd: 24,
    roiPercent: 47.5,
    ethUsd: 2447.7,
    rank: 77,
    leaderboardShare: 0.00424,
  });

  assert.match(report, /Cookies: <b>8.8K<\/b>/);
  assert.match(report, /Rank: <b>#77<\/b>/);
  assert.match(report, /Leaderboard reward:/);
  assert.match(report, /Leaderboard share: 0.424% of the 70% leaderboard bucket/);
  assert.match(report, /Activity payout: separate 30% bucket/i);
  assert.match(report, /Leaderboard ROI: <b>\+47.5%<\/b>/);
});

test('renders a division season check report with standard-specific wording', () => {
  const report = renderCheckReport({
    identity: 'Arcanum',
    profile: { name: 'Arcanum' },
    address: '0x4c29b502f5270ce4f4e70b4a7deecaaec21e3c8c',
    payoutModel: 'division-standard-open',
    season: { id: 6, prizePool: '10000000000000000000' },
    seasonStartTime: 1777000000,
    bakery: { name: 'Arcanum', tierId: 1 },
    bakeryValue: null,
    member: { txCount: '170000000', bakedTxCount: '195364000' },
    txCount: 11643,
    gasSpentEth: 0.08062,
    gasSpentUsd: 196,
    rewardEth: 0.0583,
    rewardUsd: 142,
    netEth: -0.02232,
    netUsd: -54,
    roiPercent: -27.6,
    ethUsd: 2447.7,
    rank: 18,
    leaderboardShare: 0.016,
    divisionTierId: 1,
    divisionName: 'Standard',
    hasActivityBucket: true,
  });

  assert.match(report, /Clan: <b>Arcanum<\/b> \(Standard\)/);
  assert.match(report, /Cookies: <b>19.5K<\/b>/);
  assert.match(report, /Rank: <b>#18<\/b>/);
  assert.match(report, /Standard leaderboard reward:/);
  assert.match(report, /Standard leaderboard share: 1.6% of the 25% standard leaderboard bucket/);
  assert.match(report, /Standard activity reward: separate 35% bucket/i);
  assert.match(report, /Standard ROI: <b>-27.6%<\/b>/);
});

test('renders a grouped score season check report', () => {
  const report = renderCheckReport({
    identity: 'Zoloto23',
    profile: { name: 'Zoloto23' },
    address: '0x84596032e367134926cb74fb530d41fcba6020e6',
    payoutModel: 'grouped-score-top10',
    season: { id: 7, prizePool: '10000000000000000000' },
    seasonStartTime: 1778252400,
    bakery: { name: 'ZolotoGang', rank: 6 },
    bakeryValue: null,
    member: { txCount: '880000000', bakedTxCount: '882000000', score: '150000000' },
    txCount: 55316,
    gasSpentEth: 0.33751,
    gasSpentUsd: 778,
    rewardEth: 1.5,
    rewardUsd: 3000,
    netEth: 1.16249,
    netUsd: 2222,
    roiPercent: 344.4,
    ethUsd: 2300,
    rank: 6,
    leaderboardShare: 0.6,
    memberScoreShare: 0.25,
  });

  assert.match(report, /Clan: <b>ZolotoGang<\/b> \(top 10\)/);
  assert.match(report, /Score: <b>15K<\/b>/);
  assert.match(report, /Cookies baked: <b>88.2K<\/b>/);
  assert.match(report, /Rank: <b>#6<\/b>/);
  assert.match(report, /Your est\. reward:/);
  assert.match(report, /Bakery score share: 60% of the top-10 placement pool/);
  assert.match(report, /Member score share: 25% of bakery score/);
  assert.match(report, /Score-share payout can change/);
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
