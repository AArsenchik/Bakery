import { execFile } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { renderStatCardPng } from './card.js';

const DEFAULT_BASE_URL = 'https://www.rugpullbakery.com';
const DEFAULT_ABSTRACT_RPC_URL = 'https://api.mainnet.abs.xyz';
const DEFAULT_BAKERY_CONTRACT = '0xFEB79a841D69C08aFCDC7B2BEEC8a6fbbe46C455';
const DEFAULT_PAYOUT_BPS = [5000, 2000, 1500, 1000, 500];
const DEFAULT_BAKE_TX_FEE_ETH = 0.00000675;
const BAKE_EVENT_TOPIC = '0xdfb2307530b804c690e75bb4df897c4d1ebb5e3e1187ce9e25eb7ed674c66db6';
const RECEIPT_SAMPLE_SIZE = 6;
const TOP_LIMIT = 5;
const TOP_BAKERIES_FETCH_LIMIT = 100;
const CHECK_INDEX_BAKERY_LIMIT = 12;
const CHECK_MEMBER_BAKERY_LIMIT = 5;
const CHECK_MEMBER_FETCH_LIMIT = 150;
const CHECK_TOP_CHEF_PAGES = 3;
const COOKIE_UNIT = 1000;
const CACHE_FILE = new URL('../.cache/latest-report.json', import.meta.url);
const CHECK_INDEX_FILE = new URL('../.cache/latest-check-index.json', import.meta.url);
const CHAT_REGISTRY_FILE = new URL('../.cache/known-chats.json', import.meta.url);
const BASELINE_CHAT_REGISTRY_FILE = new URL('../data/all-time-known-chats-baseline.json', import.meta.url);
const BOT_LOCK_FILE = new URL('../.cache/bot.lock.json', import.meta.url);
const CACHE_TTL_MS = 30_000;
const CACHE_STALE_MS = 10 * 60_000;
const CHECK_INDEX_TTL_MS = 30_000;
const CHECK_REPORT_TTL_MS = 30_000;
const CHECK_STATS_TTL_MS = 2 * 60_000;
const CHECK_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_CONCURRENT_UPDATES = 6;
const DEFAULT_MAX_SCHEDULED_UPDATES = 24;
const PROCESSED_UPDATE_TTL_MS = 10 * 60_000;
const HIDDEN_STATS_COMMAND = '/statsss777';
const MOSCOW_TIME_ZONE = 'Europe/Moscow';

const MEDALS = ['🥇', '🥈', '🥉', '🏅', '🏅'];
const checkSessions = new Map();
let reportCache = null;
let refreshInFlight = null;
let checkIndexCache = null;
let checkIndexInFlight = null;
const checkReportCache = new Map();
const checkStatsCache = new Map();
const checkReportInFlight = new Map();
const seasonStartBlockCache = new Map();
const processedUpdateIds = new Map();
let knownChats = new Set();
let baselineKnownChats = new Set();
const execFileAsync = promisify(execFile);
let botLockAcquired = false;

function candidateBaseUrls() {
  const configured = env('RUGPULL_BASE_URL', DEFAULT_BASE_URL);
  const urls = [configured];

  if (configured.includes('://www.')) {
    urls.push(configured.replace('://www.', '://'));
  } else {
    const url = new URL(configured);
    urls.push(`${url.protocol}//www.${url.host}${url.pathname}`.replace(/\/$/, ''));
  }

  return [...new Set(urls)];
}

function env(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function toNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value for ${label}: ${value}`);
  }
  return number;
}

function weiToEth(wei) {
  return toNumber(wei, 'wei') / 1e18;
}

function compactCookies(value) {
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M`;
  if (value >= 1_000) return `${formatNumber(value / 1_000, 1)}K`;
  return formatNumber(value, 0);
}

function countKnownChats() {
  const allChats = [...new Set([...baselineKnownChats, ...knownChats])];
  const groupChats = allChats.filter((chatId) => String(chatId).startsWith('-')).length;
  const privateUsers = allChats.length - groupChats;

  return {
    totalChats: allChats.length,
    privateUsers,
    groupChats,
  };
}

function formatNumber(value, maxFractionDigits = 4) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatEth(value, maxFractionDigits = 6) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function formatMoscowDateTime(value, { includeSeconds = true } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MOSCOW_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const time = includeSeconds
    ? `${byType.hour}:${byType.minute}:${byType.second}`
    : `${byType.hour}:${byType.minute}`;

  return `${byType.day} ${byType.month} ${byType.year}, ${time} MSK`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shortAddress(address) {
  if (!address) return 'n/a';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsdCompact(value, maxFractionDigits = 0) {
  if (value === null || value === undefined) return null;
  return `$${formatNumber(Math.abs(value), maxFractionDigits)}`;
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function normalizeName(value) {
  return String(value).trim().toLowerCase();
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value).trim());
}

function parseCommandText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { command: '', argument: '' };

  const [rawCommand = '', ...rest] = trimmed.split(/\s+/);
  return {
    command: rawCommand.toLowerCase().split('@')[0],
    argument: rest.join(' ').trim(),
  };
}

function isGroupChat(chat) {
  return ['group', 'supergroup'].includes(chat?.type);
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const waiters = [];

  async function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }

    await new Promise((resolve) => waiters.push(resolve));
    active += 1;
  }

  function release() {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  }

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export function createConversationScheduler(maxConcurrent = DEFAULT_MAX_CONCURRENT_UPDATES) {
  const limiter = createLimiter(Math.max(1, maxConcurrent));
  const queues = new Map();

  return {
    schedule(key, task) {
      const conversationKey = key ?? `task:${Date.now()}:${Math.random()}`;
      const previous = queues.get(conversationKey) ?? Promise.resolve();

      const next = previous
        .catch(() => {})
        .then(() => limiter.run(task));

      let trackedPromise;
      trackedPromise = next.finally(() => {
        if (queues.get(conversationKey) === trackedPromise) {
          queues.delete(conversationKey);
        }
      });

      queues.set(conversationKey, trackedPromise);
      return trackedPromise;
    },
  };
}

export function conversationKeyForUpdate(update) {
  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;

  if (chatId !== undefined && userId !== undefined) {
    return `${String(chatId)}:${String(userId)}`;
  }

  return `update:${String(update?.update_id ?? Date.now())}`;
}

function makeCheckSessionKey(chatId, userId) {
  return `${String(chatId)}:${String(userId)}`;
}

function isCheckSessionExpired(session) {
  return !session || Date.now() - session.createdAtMs > CHECK_SESSION_TTL_MS;
}

function cleanExpiredCheckSession(chatId, userId) {
  const key = makeCheckSessionKey(chatId, userId);
  const session = checkSessions.get(key);
  if (isCheckSessionExpired(session)) {
    checkSessions.delete(key);
    return null;
  }
  return session;
}

export function shouldAcceptCheckIdentityMessage(session, message) {
  if (!session || !message?.text) return false;
  if (isCheckSessionExpired(session)) return false;

  if (!session.isGroup) return true;

  return Number(message?.reply_to_message?.message_id) === Number(session.promptMessageId);
}

function pruneProcessedUpdates(now = Date.now()) {
  for (const [updateId, processedAtMs] of processedUpdateIds.entries()) {
    if (now - processedAtMs > PROCESSED_UPDATE_TTL_MS) {
      processedUpdateIds.delete(updateId);
    }
  }
}

export function shouldProcessUpdate(update) {
  const updateId = update?.update_id;
  if (updateId === undefined || updateId === null) return true;

  const now = Date.now();
  pruneProcessedUpdates(now);
  if (processedUpdateIds.has(updateId)) {
    return false;
  }

  processedUpdateIds.set(updateId, now);
  return true;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireBotLock() {
  await mkdir(new URL('.', BOT_LOCK_FILE), { recursive: true });

  try {
    const existing = JSON.parse(await readFile(BOT_LOCK_FILE, 'utf8'));
    const existingPid = Number(existing?.pid);
    if (Number.isInteger(existingPid) && existingPid > 0 && existingPid !== process.pid && processExists(existingPid)) {
      throw new Error(`Another bot instance is already running with PID ${existingPid}`);
    }
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') {
      if (String(error.message).includes('Another bot instance')) throw error;
    }
  }

  await writeFile(BOT_LOCK_FILE, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }, null, 2));
  botLockAcquired = true;
}

async function releaseBotLock() {
  if (!botLockAcquired) return;

  try {
    const existing = JSON.parse(await readFile(BOT_LOCK_FILE, 'utf8'));
    if (Number(existing?.pid) === process.pid) {
      await unlink(BOT_LOCK_FILE);
    }
  } catch {}

  botLockAcquired = false;
}

function cacheAgeMs(cache) {
  return cache ? Date.now() - cache.generatedAtMs : Infinity;
}

function isCacheFresh(cache) {
  return cacheAgeMs(cache) <= CACHE_TTL_MS;
}

function isCacheUsable(cache) {
  return cacheAgeMs(cache) <= CACHE_STALE_MS;
}

async function readCacheFile(cacheFile) {
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCacheFile(cacheFile, cache) {
  await mkdir(new URL('.', cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache, null, 2));
}

async function loadReportCache() {
  reportCache = await readCacheFile(CACHE_FILE);
}

async function saveReportCache(cache) {
  await writeCacheFile(CACHE_FILE, cache);
}

function serializeCheckIndex(index) {
  return {
    generatedAtMs: index.generatedAtMs,
    baseUrl: index.baseUrl,
    bakeryContract: index.bakeryContract,
    rpcHttp: index.rpcHttp,
    season: index.season,
    ethUsd: index.ethUsd,
    seasonStartTime: index.seasonStartTime,
    bakeryMap: [...index.bakeryMap.entries()],
    bakeryValueMap: [...index.bakeryValueMap.entries()],
    memberMap: [...index.memberMap.entries()],
    profileMap: [...index.profileMap.entries()],
    profileNameMap: [...index.profileNameMap.entries()],
  };
}

function deserializeCheckIndex(serialized) {
  if (!serialized || typeof serialized !== 'object') return null;
  return {
    generatedAtMs: serialized.generatedAtMs ?? 0,
    baseUrl: serialized.baseUrl ?? env('RUGPULL_BASE_URL', DEFAULT_BASE_URL),
    bakeryContract: serialized.bakeryContract ?? env('BAKERY_CONTRACT_ADDRESS', DEFAULT_BAKERY_CONTRACT),
    rpcHttp: serialized.rpcHttp ?? env('ABSTRACT_RPC_URL', DEFAULT_ABSTRACT_RPC_URL),
    season: serialized.season ?? null,
    ethUsd: serialized.ethUsd ?? null,
    seasonStartTime: serialized.seasonStartTime ?? null,
    bakeryMap: new Map(serialized.bakeryMap ?? []),
    bakeryValueMap: new Map(serialized.bakeryValueMap ?? []),
    memberMap: new Map(serialized.memberMap ?? []),
    profileMap: new Map(serialized.profileMap ?? []),
    profileNameMap: new Map(serialized.profileNameMap ?? []),
  };
}

async function loadCheckIndexCache() {
  checkIndexCache = deserializeCheckIndex(await readCacheFile(CHECK_INDEX_FILE));
}

async function saveCheckIndexCache(index) {
  await writeCacheFile(CHECK_INDEX_FILE, serializeCheckIndex(index));
}

async function loadKnownChats() {
  const stored = await readCacheFile(CHAT_REGISTRY_FILE);
  knownChats = new Set(Array.isArray(stored) ? stored.map((value) => String(value)) : []);
}

async function loadBaselineKnownChats() {
  const stored = await readCacheFile(BASELINE_CHAT_REGISTRY_FILE);
  baselineKnownChats = new Set(Array.isArray(stored) ? stored.map((value) => String(value)) : []);
}

async function saveKnownChats() {
  await writeCacheFile(CHAT_REGISTRY_FILE, [...knownChats].sort());
}

async function registerChat(chatId) {
  const normalized = String(chatId);
  if (knownChats.has(normalized)) return;
  knownChats.add(normalized);
  await saveKnownChats();
}

function unwrapTrpcJson(payload, procedureName) {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const json = first?.result?.data?.json;
  if (json === undefined) {
    throw new Error(`Unexpected tRPC response from ${procedureName}`);
  }
  return json;
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 10_000, ...fetchOptions } = options;
  try {
    const signal = fetchOptions.signal ?? AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      ...fetchOptions,
      headers: { accept: 'application/json', ...fetchOptions.headers },
      signal,
    });

    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const curlArgs = [
      '-sS',
      '--max-time',
      String(timeoutSeconds),
      '-H',
      'accept: application/json',
    ];

    for (const [headerName, headerValue] of Object.entries(fetchOptions.headers ?? {})) {
      curlArgs.push('-H', `${headerName}: ${headerValue}`);
    }

    if (fetchOptions.method && fetchOptions.method !== 'GET') {
      curlArgs.push('-X', fetchOptions.method);
    }

    if (fetchOptions.body !== undefined) {
      curlArgs.push('--data', String(fetchOptions.body));
    }

    curlArgs.push(String(url));

    try {
      const { stdout } = await execFileAsync('curl', curlArgs, {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (curlError) {
      throw new Error(`${error.message}; curl fallback failed: ${curlError.message}`);
    }
  }
}

async function fetchText(url, options = {}) {
  const { timeoutMs = 10_000, ...fetchOptions } = options;
  try {
    const signal = fetchOptions.signal ?? AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      ...fetchOptions,
      headers: { accept: 'text/html,*/*', ...fetchOptions.headers },
      signal,
    });

    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  } catch (error) {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const curlArgs = [
      '-sS',
      '--max-time',
      String(timeoutSeconds),
      '-H',
      'accept: text/html,*/*',
    ];

    for (const [headerName, headerValue] of Object.entries(fetchOptions.headers ?? {})) {
      curlArgs.push('-H', `${headerName}: ${headerValue}`);
    }

    if (fetchOptions.method && fetchOptions.method !== 'GET') {
      curlArgs.push('-X', fetchOptions.method);
    }

    if (fetchOptions.body !== undefined) {
      curlArgs.push('--data', String(fetchOptions.body));
    }

    curlArgs.push(String(url));

    try {
      const { stdout } = await execFileAsync('curl', curlArgs, {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (curlError) {
      throw new Error(`${error.message}; curl fallback failed: ${curlError.message}`);
    }
  }
}

async function rpcRequest(url, method, params, options = {}) {
  const { timeoutMs = 15_000, maxBuffer = 64 * 1024 * 1024 } = options;
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  };

  try {
    const response = await fetch(String(url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`RPC ${method} failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC ${method} failed: ${data.error.message ?? JSON.stringify(data.error)}`);
    }
    return data.result;
  } catch (error) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '-sS',
        url,
        '-H',
        'content-type: application/json',
        '--data',
        JSON.stringify(payload),
      ], {
        timeout: timeoutMs,
        maxBuffer,
      });

      const data = JSON.parse(stdout);
      if (data.error) {
        throw new Error(`RPC ${method} failed: ${data.error.message ?? JSON.stringify(data.error)}`);
      }
      return data.result;
    } catch (curlError) {
      throw new Error(`${error.message}; RPC curl fallback failed: ${curlError.message}`);
    }
  }
}

async function rpcBatchRequest(url, requests, options = {}) {
  const { timeoutMs = 15_000, maxBuffer = 16 * 1024 * 1024 } = options;
  if (!requests.length) return [];

  const payload = requests.map((request, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: request.method,
    params: request.params,
  }));

  try {
    const response = await fetch(String(url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`RPC batch request failed: ${response.status} ${response.statusText}`);
    }

    const responses = await response.json();
    if (!Array.isArray(responses)) {
      throw new Error('RPC batch request returned a non-array response');
    }

    const byId = new Map(responses.map((rpcResponse) => [rpcResponse.id, rpcResponse]));
    return payload.map((request) => {
      const rpcResponse = byId.get(request.id);
      if (!rpcResponse) {
        throw new Error(`RPC batch ${request.method} response is missing`);
      }
      if (rpcResponse.error) {
        throw new Error(`RPC ${request.method} failed: ${rpcResponse.error.message ?? JSON.stringify(rpcResponse.error)}`);
      }
      return rpcResponse.result ?? null;
    });
  } catch (error) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '-sS',
        url,
        '-H',
        'content-type: application/json',
        '--data',
        JSON.stringify(payload),
      ], {
        timeout: timeoutMs,
        maxBuffer,
      });

      const responses = JSON.parse(stdout);
      if (!Array.isArray(responses)) {
        throw new Error('RPC batch request returned a non-array response');
      }

      const byId = new Map(responses.map((rpcResponse) => [rpcResponse.id, rpcResponse]));
      return payload.map((request) => {
        const rpcResponse = byId.get(request.id);
        if (!rpcResponse) {
          throw new Error(`RPC batch ${request.method} response is missing`);
        }
        if (rpcResponse.error) {
          throw new Error(`RPC ${request.method} failed: ${rpcResponse.error.message ?? JSON.stringify(rpcResponse.error)}`);
        }
        return rpcResponse.result ?? null;
      });
    } catch (curlError) {
      throw new Error(`${error.message}; RPC curl fallback failed: ${curlError.message}`);
    }
  }
}

function topicForAddress(address) {
  return `0x${String(address).toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function topicForUint(value) {
  return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

function uniqueTransactionHashes(logs) {
  const seen = new Set();
  const hashes = [];

  for (const entry of logs) {
    const hash = String(entry?.transactionHash ?? '').toLowerCase();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    hashes.push(hash);
  }

  return hashes;
}

function pickSampleItems(items, sampleSize = RECEIPT_SAMPLE_SIZE) {
  if (items.length <= sampleSize) return [...items];
  if (sampleSize <= 1) return [items[0]];

  const sampled = [];
  for (let index = 0; index < sampleSize; index += 1) {
    const position = Math.floor((index * (items.length - 1)) / (sampleSize - 1));
    sampled.push(items[position]);
  }

  return [...new Set(sampled)];
}

function receiptFeeEth(receipt) {
  if (!receipt?.gasUsed || !receipt?.effectiveGasPrice) return null;

  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
  return Number(gasUsed * effectiveGasPrice) / 1e18;
}

function blockToHex(blockNumber) {
  return `0x${blockNumber.toString(16)}`;
}

function parseHexBlock(value) {
  return BigInt(String(value));
}

function parseUnixTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;

  try {
    return BigInt(String(value));
  } catch {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return BigInt(Math.floor(numeric));
  }
}

function parseSuggestedBlockRange(message) {
  const match = String(message).match(/\[(0x[a-f0-9]+),\s*(0x[a-f0-9]+)\]/i);
  if (!match) return null;

  return {
    fromBlock: parseHexBlock(match[1]),
    toBlock: parseHexBlock(match[2]),
  };
}

async function fetchLatestBlockNumber(rpcHttp) {
  return parseHexBlock(await rpcRequest(rpcHttp, 'eth_blockNumber', [], { timeoutMs: 10_000 }));
}

async function fetchBlockHeader(rpcHttp, blockNumber) {
  const block = await rpcRequest(rpcHttp, 'eth_getBlockByNumber', [blockToHex(blockNumber), false], {
    timeoutMs: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (!block?.number || !block?.timestamp) {
    throw new Error(`Could not fetch block header for ${blockNumber.toString()}`);
  }

  return {
    number: parseHexBlock(block.number),
    timestamp: parseHexBlock(block.timestamp),
  };
}

async function findFirstBlockAtOrAfterTimestamp(rpcHttp, unixTimestamp) {
  const targetTimestamp = parseUnixTimestamp(unixTimestamp);
  if (targetTimestamp === null) return 0n;

  const latestBlockNumber = await fetchLatestBlockNumber(rpcHttp);
  const latestBlock = await fetchBlockHeader(rpcHttp, latestBlockNumber);
  if (latestBlock.timestamp <= targetTimestamp) {
    return latestBlock.number;
  }

  let low = 0n;
  let high = latestBlock.number;

  while (low < high) {
    const mid = low + ((high - low) / 2n);
    const block = await fetchBlockHeader(rpcHttp, mid);
    if (block.timestamp < targetTimestamp) {
      low = mid + 1n;
    } else {
      high = mid;
    }
  }

  return low;
}

async function findSeasonStartBlock(rpcHttp, seasonId, seasonStartTime) {
  const parsedStartTime = parseUnixTimestamp(seasonStartTime);
  if (parsedStartTime === null) return 0n;

  const cacheKey = `${rpcHttp}:${seasonId}:${parsedStartTime.toString()}`;
  const cached = seasonStartBlockCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const blockNumber = await findFirstBlockAtOrAfterTimestamp(rpcHttp, parsedStartTime);
  seasonStartBlockCache.set(cacheKey, blockNumber);
  return blockNumber;
}

async function fetchLogsForRange(rpcHttp, filter, fromBlock, toBlock) {
  try {
    return await rpcRequest(rpcHttp, 'eth_getLogs', [{
      ...filter,
      fromBlock: blockToHex(fromBlock),
      toBlock: blockToHex(toBlock),
    }], {
      timeoutMs: 20_000,
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    const suggested = parseSuggestedBlockRange(error.message);
    if (suggested && suggested.toBlock >= fromBlock && suggested.toBlock < toBlock) {
      const firstChunk = await rpcRequest(rpcHttp, 'eth_getLogs', [{
        ...filter,
        fromBlock: blockToHex(fromBlock),
        toBlock: blockToHex(suggested.toBlock),
      }], {
        timeoutMs: 20_000,
        maxBuffer: 128 * 1024 * 1024,
      });

      const rest = suggested.toBlock + 1n <= toBlock
        ? await fetchLogsForRange(rpcHttp, filter, suggested.toBlock + 1n, toBlock)
        : [];
      return [...firstChunk, ...rest];
    }

    if (fromBlock >= toBlock) throw error;

    const midpoint = fromBlock + ((toBlock - fromBlock) / 2n);
    const left = await fetchLogsForRange(rpcHttp, filter, fromBlock, midpoint);
    const right = midpoint + 1n <= toBlock
      ? await fetchLogsForRange(rpcHttp, filter, midpoint + 1n, toBlock)
      : [];
    return [...left, ...right];
  }
}

function trpcUrl(baseUrl, procedureName, input = {}) {
  const url = new URL(`/api/trpc/${procedureName}`, baseUrl);
  url.searchParams.set('batch', '1');
  url.searchParams.set('input', JSON.stringify({ 0: { json: input } }));
  return url;
}

async function withBaseUrlFallback(loader) {
  let lastError = null;

  for (const baseUrl of candidateBaseUrls()) {
    try {
      return await loader(baseUrl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Could not reach Rugpull Bakery');
}

function bakeTxFeeEth() {
  return toNumber(env('BAKE_TX_FEE_ETH', String(DEFAULT_BAKE_TX_FEE_ETH)), 'BAKE_TX_FEE_ETH');
}

async function fetchAgent(baseUrl) {
  return fetchJson(new URL('/agent.json', baseUrl), { timeoutMs: 1_500 });
}

async function fetchActiveSeason(baseUrl) {
  const json = unwrapTrpcJson(
    await fetchJson(trpcUrl(baseUrl, 'leaderboard.getActiveSeason'), { timeoutMs: 6_000 }),
    'leaderboard.getActiveSeason',
  );

  const season = Array.isArray(json) ? json[0] : json;
  if (!season) throw new Error('Active season was not found');
  return season;
}

async function fetchTopBakeries(baseUrl, seasonId = undefined, limit = TOP_LIMIT) {
  const input = { limit };
  if (seasonId !== undefined) input.seasonId = seasonId;

  const json = unwrapTrpcJson(
    await fetchJson(trpcUrl(baseUrl, 'leaderboard.getTopBakeries', input), { timeoutMs: 6_000 }),
    'leaderboard.getTopBakeries',
  );

  const items = Array.isArray(json) ? json : json.items;
  if (!Array.isArray(items)) throw new Error('Top bakeries response does not contain items');
  return items.slice(0, limit);
}

async function fetchTopChefsPage(baseUrl, seasonId, limit = 100, cursor = undefined) {
  const input = { seasonId, limit };
  if (cursor) input.cursor = cursor;

  const json = unwrapTrpcJson(
    await fetchJson(trpcUrl(baseUrl, 'leaderboard.getTopChefs', input), { timeoutMs: 6_000 }),
    'leaderboard.getTopChefs',
  );

  const items = Array.isArray(json) ? json : json.items;
  const nextCursor = Array.isArray(json) ? null : (json.nextCursor ?? null);
  if (!Array.isArray(items)) throw new Error('Top chefs response does not contain items');
  return { items, nextCursor };
}

async function fetchBakeryMembers(baseUrl, bakeryId, seasonId, limit = 200) {
  const json = unwrapTrpcJson(
    await fetchJson(trpcUrl(baseUrl, 'leaderboard.getBakeryMembers', { bakeryId, seasonId, limit }), { timeoutMs: 6_000 }),
    'leaderboard.getBakeryMembers',
  );

  const items = Array.isArray(json) ? json : json.items;
  if (!Array.isArray(items)) throw new Error('Bakery members response does not contain items');
  return items;
}

async function fetchBakeryById(baseUrl, bakeryId, seasonId) {
  return unwrapTrpcJson(
    await fetchJson(trpcUrl(baseUrl, 'leaderboard.getBakeryById', { bakeryId, seasonId }), { timeoutMs: 6_000 }),
    'leaderboard.getBakeryById',
  );
}

async function fetchProfilesByAddresses(baseUrl, addresses) {
  if (!addresses.length) return [];

  const results = [];
  for (const batch of chunk(addresses, 100)) {
    const json = unwrapTrpcJson(
      await fetchJson(trpcUrl(baseUrl, 'profiles.getByAddresses', { addresses: batch }), { timeoutMs: 6_000 }),
      'profiles.getByAddresses',
    );
    results.push(...(Array.isArray(json) ? json : []));
  }
  return results;
}

async function fetchEthUsd() {
  const fallback = env('ETH_USD_FALLBACK');
  if (fallback) return toNumber(fallback, 'ETH_USD_FALLBACK');

  const coingeckoUrl = new URL('https://api.coingecko.com/api/v3/simple/price');
  coingeckoUrl.searchParams.set('ids', 'ethereum');
  coingeckoUrl.searchParams.set('vs_currencies', 'usd');

  const binanceUrl = new URL('https://api.binance.com/api/v3/ticker/price');
  binanceUrl.searchParams.set('symbol', 'ETHUSDT');

  const coinbaseUrl = new URL('https://api.coinbase.com/v2/prices/ETH-USD/spot');

  const providers = [
    async () => {
      const data = await fetchJson(coingeckoUrl, { timeoutMs: 10_000 });
      return toNumber(data?.ethereum?.usd, 'coingecko.ethereum.usd');
    },
    async () => {
      const data = await fetchJson(binanceUrl, { timeoutMs: 10_000 });
      return toNumber(data?.price, 'binance.ETHUSDT.price');
    },
    async () => {
      const data = await fetchJson(coinbaseUrl, { timeoutMs: 10_000 });
      return toNumber(data?.data?.amount, 'coinbase.ETH-USD.amount');
    },
  ];

  try {
    return await Promise.any(providers.map((provider) => provider()));
  } catch (error) {
    console.warn(`Could not fetch ETH/USD: ${error.message}`);
    return null;
  }
}

function payoutStructureFromSeason(season) {
  const live = season?.payoutStructureBps;
  if (Array.isArray(live) && live.length >= TOP_LIMIT) {
    return live.slice(0, TOP_LIMIT).map((value) => toNumber(value, 'payoutStructureBps'));
  }
  return DEFAULT_PAYOUT_BPS;
}

export function calculateCookieValues({ agent, season, bakeries, ethUsd }) {
  const cookieScale = toNumber(agent?.liveState?.gameplayCaps?.cookieScale ?? 10000, 'cookieScale');
  const prizePoolEth = weiToEth(season.prizePool ?? season.finalizedPrizePool ?? agent?.liveState?.prizePoolWei);
  const payoutBps = payoutStructureFromSeason(season);

  return bakeries.map((bakery, index) => {
    const cookies = toNumber(bakery.cookieBalance ?? bakery.txCount ?? bakery.cookiesBaked, `bakery[${index}].cookieBalance`) / cookieScale;
    const prizeEth = prizePoolEth * (payoutBps[index] / 10000);
    const ethPerThousandCookies = cookies > 0 ? (prizeEth / cookies) * COOKIE_UNIT : 0;
    const usdPerThousandCookies = ethUsd ? ethPerThousandCookies * ethUsd : null;
    const prizeUsd = ethUsd ? prizeEth * ethUsd : null;

    return {
      rank: index + 1,
      medal: MEDALS[index] ?? '🏅',
      name: bakery.name,
      payoutBps: payoutBps[index],
      prizeEth,
      prizeUsd,
      cookies,
      ethPerThousandCookies,
      usdPerThousandCookies,
    };
  });
}

export function renderValueReport({ values, season, ethUsd, generatedAt }) {
  const lines = ['<b>Value of 1,000 cookies:</b>', ''];

  for (const item of values) {
    const payoutPercent = item.payoutBps / 100;
    const prizeUsd = item.prizeUsd === null ? '' : ` ($${formatNumber(item.prizeUsd, 0)})`;
    const valueUsd = item.usdPerThousandCookies === null ? 'n/a' : `$${formatNumber(item.usdPerThousandCookies, 4)}`;

    lines.push(`${item.medal} <b>${escapeHtml(item.name)}</b>`);
    lines.push(`Prize: ${formatEth(item.prizeEth, 3)} ETH${prizeUsd} [${formatNumber(payoutPercent, 2)}%]`);
    lines.push(`Total cookies: ${compactCookies(item.cookies)}`);
    lines.push(`1,000 🍪 = ${valueUsd} (${formatEth(item.ethPerThousandCookies, 6)} ETH)`);
    lines.push('');
  }

  lines.push(`Prize pool: ${formatEth(weiToEth(season.prizePool ?? season.finalizedPrizePool), 4)} ETH`);
  if (ethUsd) lines.push(`ETH/USD: $${formatNumber(ethUsd, 2)}`);
  lines.push(`Updated: ${formatMoscowDateTime(generatedAt)}`);

  return lines.join('\n').trim();
}

export function renderWelcomeMessage() {
  return [
    '<b>Rugpull Bakery Bot</b>',
    '',
    '<b>/cookie</b> - show the current value of 1,000 cookies for the top 5 bakeries',
    '<b>/ch</b> - check a player\'s current season profit/loss',
  ].join('\n');
}

export function renderHiddenStatsMessage(stats, generatedAt = new Date()) {
  return [
    '<b>Bot Stats</b>',
    '',
    `Users: <b>${formatNumber(stats.privateUsers, 0)}</b>`,
    `Groups: <b>${formatNumber(stats.groupChats, 0)}</b>`,
    `Total chats: <b>${formatNumber(stats.totalChats, 0)}</b>`,
    '',
    `Updated: ${formatMoscowDateTime(generatedAt)}`,
  ].join('\n');
}

function extractSeasonStartTime(activeSeason, bakeries, members) {
  const explicitSeasonStart = Number(activeSeason?.startTime);
  if (Number.isFinite(explicitSeasonStart) && explicitSeasonStart > 1000) {
    return explicitSeasonStart;
  }

  const candidates = [activeSeason?.startTime, ...bakeries.map((item) => item.createdAt), ...members.map((item) => item.registeredAt)]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 1000);

  return candidates.length ? Math.min(...candidates) : null;
}

function memberFromChef(chef, seasonId) {
  return {
    seasonId,
    address: String(chef.address).toLowerCase(),
    bakeryId: chef.bakeryId,
    txCount: chef.txCount,
    bakedTxCount: chef.bakedTxCount,
    effectiveTxCount: chef.effectiveTxCount,
    referralCount: chef.referralCount ?? 0,
    boostAttempts: chef.boostAttempts ?? 0,
    boostLanded: chef.boostLanded ?? 0,
    rugAttempts: chef.rugAttempts ?? 0,
    rugLanded: chef.rugLanded ?? 0,
  };
}

function mergeMember(existing, next) {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    address: next.address ?? existing.address,
    bakeryId: next.bakeryId ?? existing.bakeryId,
    txCount: next.txCount ?? existing.txCount,
    bakedTxCount: next.bakedTxCount ?? existing.bakedTxCount,
    effectiveTxCount: next.effectiveTxCount ?? existing.effectiveTxCount,
    registeredAt: next.registeredAt ?? existing.registeredAt,
  };
}

async function prefetchTopChefSlice(baseUrl, seasonId, maxPages = CHECK_TOP_CHEF_PAGES, limit = 100) {
  const items = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchTopChefsPage(baseUrl, seasonId, limit, cursor);
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return items;
}

async function buildCheckIndex() {
  const { baseUrl, agent, season, bakeries } = await withBaseUrlFallback(async (resolvedBaseUrl) => {
    const [resolvedAgent, resolvedSeason, resolvedBakeries] = await Promise.all([
      fetchAgent(resolvedBaseUrl).catch((error) => {
        console.warn(`Could not fetch agent.json for /ch, using default cookie scale: ${error.message}`);
        return { liveState: { gameplayCaps: { cookieScale: 10000 } } };
      }),
      fetchActiveSeason(resolvedBaseUrl),
      fetchTopBakeries(resolvedBaseUrl, undefined, CHECK_INDEX_BAKERY_LIMIT),
    ]);

    return {
      baseUrl: resolvedBaseUrl,
      agent: resolvedAgent,
      season: resolvedSeason,
      bakeries: resolvedBakeries,
    };
  });

  const seasonId = season.id;
  const rpcHttp = agent?.network?.rpcHttp ?? env('ABSTRACT_RPC_URL', DEFAULT_ABSTRACT_RPC_URL);
  const bakeryContract = agent?.contracts?.bakery ?? env('BAKERY_CONTRACT_ADDRESS', DEFAULT_BAKERY_CONTRACT);
  const indexedBakeries = bakeries.slice(0, CHECK_MEMBER_BAKERY_LIMIT);
  const [ethUsd, memberLists, topChefItems] = await Promise.all([
    fetchEthUsd(),
    Promise.all(
      indexedBakeries.map((bakery) => (
        fetchBakeryMembers(baseUrl, bakery.id, seasonId, CHECK_MEMBER_FETCH_LIMIT).catch(() => [])
      )),
    ),
    prefetchTopChefSlice(baseUrl, seasonId).catch(() => []),
  ]);
  const bakeryValues = calculateCookieValues({
    agent,
    season,
    bakeries: bakeries.slice(0, TOP_LIMIT),
    ethUsd,
  });
  const bakeryValueMap = new Map(bakeryValues.map((item) => [item.name, item]));
  const bakeryMap = new Map(bakeries.map((bakery) => [bakery.id, bakery]));

  const memberMap = new Map();
  const members = [...memberLists.flat(), ...topChefItems.map((item) => memberFromChef(item, seasonId))];
  for (const member of members) {
    const address = String(member.address).toLowerCase();
    memberMap.set(address, mergeMember(memberMap.get(address), { ...member, address }));
  }

  const profileAddressSet = new Set([...memberMap.keys()]);
  const profiles = await fetchProfilesByAddresses(baseUrl, [...profileAddressSet]).catch((error) => {
    console.warn(`Could not prefetch profiles for /ch index: ${error.message}`);
    return [];
  });
  const profileMap = new Map();
  const profileNameMap = new Map();

  for (const entry of profiles) {
    const address = String(entry.address).toLowerCase();
    const profile = entry.profile ?? null;
    profileMap.set(address, profile);
    if (profile?.name) {
      profileNameMap.set(normalizeName(profile.name), address);
    }
  }

  const seasonStartTime = extractSeasonStartTime(season, bakeries, members);

  return {
    generatedAtMs: Date.now(),
    baseUrl,
    bakeryContract,
    rpcHttp,
    season,
    ethUsd,
    bakeryMap,
    bakeryValueMap,
    memberMap,
    profileMap,
    profileNameMap,
    seasonStartTime,
  };
}

async function buildMinimalCheckIndex() {
  const { baseUrl, agent, season, bakeries } = await withBaseUrlFallback(async (resolvedBaseUrl) => {
    const [resolvedAgent, resolvedSeason, resolvedBakeries] = await Promise.all([
      fetchAgent(resolvedBaseUrl).catch((error) => {
        console.warn(`Could not fetch agent.json for minimal /ch index, using default cookie scale: ${error.message}`);
        return { liveState: { gameplayCaps: { cookieScale: 10000 } } };
      }),
      fetchActiveSeason(resolvedBaseUrl),
      fetchTopBakeries(resolvedBaseUrl, undefined, CHECK_INDEX_BAKERY_LIMIT),
    ]);

    return {
      baseUrl: resolvedBaseUrl,
      agent: resolvedAgent,
      season: resolvedSeason,
      bakeries: resolvedBakeries,
    };
  });

  const ethUsd = await fetchEthUsd();
  const bakeryValues = calculateCookieValues({
    agent,
    season,
    bakeries: bakeries.slice(0, TOP_LIMIT),
    ethUsd,
  });

  return {
    generatedAtMs: Date.now(),
    baseUrl,
    bakeryContract: agent?.contracts?.bakery ?? env('BAKERY_CONTRACT_ADDRESS', DEFAULT_BAKERY_CONTRACT),
    rpcHttp: agent?.network?.rpcHttp ?? env('ABSTRACT_RPC_URL', DEFAULT_ABSTRACT_RPC_URL),
    season,
    ethUsd,
    bakeryMap: new Map(bakeries.map((bakery) => [bakery.id, bakery])),
    bakeryValueMap: new Map(bakeryValues.map((item) => [item.name, item])),
    memberMap: new Map(),
    profileMap: new Map(),
    profileNameMap: new Map(),
    seasonStartTime: extractSeasonStartTime(season, bakeries, []),
  };
}

function refreshCheckIndex() {
  if (checkIndexInFlight) return checkIndexInFlight;

  checkIndexInFlight = buildCheckIndex()
    .then(async (index) => {
      checkIndexCache = index;
      await saveCheckIndexCache(index);
      return index;
    })
    .finally(() => {
      checkIndexInFlight = null;
    });

  return checkIndexInFlight;
}

async function getCheckIndex() {
  if (checkIndexCache && Date.now() - checkIndexCache.generatedAtMs <= CHECK_INDEX_TTL_MS) {
    return checkIndexCache;
  }

  if (checkIndexCache) {
    refreshCheckIndex();
    return checkIndexCache;
  }

  try {
    return await refreshCheckIndex();
  } catch (error) {
    console.warn(`Could not build full /ch index, falling back to a lighter index: ${error.message}`);
    const minimalIndex = await buildMinimalCheckIndex();
    checkIndexCache = minimalIndex;
    saveCheckIndexCache(minimalIndex).catch(() => {});
    return minimalIndex;
  }
}

function refreshCheckIndexInBackground(force = false) {
  if (!force && checkIndexCache && Date.now() - checkIndexCache.generatedAtMs <= CHECK_INDEX_TTL_MS) {
    return;
  }

  refreshCheckIndex()
    .then(() => {})
    .catch((error) => {
      console.warn(`Could not refresh /ch index: ${error.message}`);
    });
}

function findAddressByIdentity(index, identity) {
  const trimmed = String(identity).trim();
  if (isAddress(trimmed)) return trimmed.toLowerCase();
  return index.profileNameMap.get(normalizeName(trimmed)) ?? null;
}

async function findChefByAddress(baseUrl, seasonId, address, maxPages = 30) {
  let cursor = null;
  const target = address.toLowerCase();

  for (let page = 0; page < maxPages; page += 1) {
    const { items, nextCursor } = await fetchTopChefsPage(baseUrl, seasonId, 100, cursor);
    const chef = items.find((item) => String(item.address).toLowerCase() === target);
    if (chef) return chef;
    if (!nextCursor) return null;
    cursor = nextCursor;
  }

  return null;
}

async function findAddressByUsernameViaTopChefs(index, username, maxPages = 12) {
  let cursor = null;
  const normalized = normalizeName(username);

  for (let page = 0; page < maxPages; page += 1) {
    const { items, nextCursor } = await fetchTopChefsPage(index.baseUrl, index.season.id, 100, cursor);
    if (!items.length) return null;

    const addresses = items.map((item) => String(item.address).toLowerCase());
    const profiles = await fetchProfilesByAddresses(index.baseUrl, addresses).catch(() => []);
    for (const entry of profiles) {
      const address = String(entry.address).toLowerCase();
      const profile = entry.profile ?? null;
      index.profileMap.set(address, profile);
      if (profile?.name) {
        index.profileNameMap.set(normalizeName(profile.name), address);
      }
    }

    const found = index.profileNameMap.get(normalized);
    if (found) {
      saveCheckIndexCache(index).catch(() => {});
      return found;
    }
    if (!nextCursor) return null;
    cursor = nextCursor;
  }

  return null;
}

async function resolveAddressByIdentity(index, identity) {
  const fromFastIndex = findAddressByIdentity(index, identity);
  if (fromFastIndex) return fromFastIndex;
  if (isAddress(identity)) return String(identity).trim().toLowerCase();
  try {
    return await findAddressByUsernameViaTopChefs(index, identity);
  } catch (error) {
    console.warn(`Could not resolve username for /ch (${identity}): ${error.message}`);
    return null;
  }
}

async function fetchSeasonBakeLogs({ rpcHttp, bakeryContract, address, seasonId, seasonStartTime }) {
  const [fromBlock, latestBlock] = await Promise.all([
    findSeasonStartBlock(rpcHttp, seasonId, seasonStartTime),
    fetchLatestBlockNumber(rpcHttp),
  ]);

  return fetchLogsForRange(rpcHttp, {
    address: bakeryContract,
    topics: [
      BAKE_EVENT_TOPIC,
      topicForAddress(address),
      topicForUint(seasonId),
    ],
  }, fromBlock, latestBlock);
}

async function fetchAverageBakeFeeEth(rpcHttp, transactionHashes) {
  const sampleHashes = pickSampleItems(transactionHashes, RECEIPT_SAMPLE_SIZE);
  if (!sampleHashes.length) return bakeTxFeeEth();

  const receipts = await rpcBatchRequest(
    rpcHttp,
    sampleHashes.map((hash) => ({ method: 'eth_getTransactionReceipt', params: [hash] })),
    {
      timeoutMs: 12_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  const fees = receipts
    .map((receipt) => receiptFeeEth(receipt))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!fees.length) return bakeTxFeeEth();
  return fees.reduce((sum, value) => sum + value, 0) / fees.length;
}

async function fetchTotalBakeFeeEth(rpcHttp, transactionHashes, {
  batchSize = 250,
  maxConcurrentBatches = 4,
} = {}) {
  if (!transactionHashes.length) return 0;

  const batches = chunk(transactionHashes, batchSize);
  const limiter = createLimiter(Math.max(1, maxConcurrentBatches));

  const batchTotals = await Promise.all(
    batches.map((batch) => limiter.run(async () => {
      const receipts = await rpcBatchRequest(
        rpcHttp,
        batch.map((hash) => ({ method: 'eth_getTransactionReceipt', params: [hash] })),
        {
          timeoutMs: 20_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );

      return receipts
        .map((receipt) => receiptFeeEth(receipt))
        .filter((value) => Number.isFinite(value) && value > 0)
        .reduce((sum, value) => sum + value, 0);
    })),
  );

  return batchTotals.reduce((sum, value) => sum + value, 0);
}

export function deriveApproxBakeTxStats({
  transactionHashes,
  cachedValue = null,
  averageFeeEth = null,
  fallbackFeeEth = DEFAULT_BAKE_TX_FEE_ETH,
}) {
  const uniqueHashes = Array.isArray(transactionHashes)
    ? [...new Set(transactionHashes)]
    : [];
  const feePerTx = Number.isFinite(averageFeeEth) && averageFeeEth > 0
    ? averageFeeEth
    : (Number.isFinite(cachedValue?.averageFeeEth) && cachedValue.averageFeeEth > 0
        ? cachedValue.averageFeeEth
        : fallbackFeeEth);

  let gasSpentEth = uniqueHashes.length * feePerTx;
  let source = 'on-chain-bake-logs-approx';

  if (
    Array.isArray(cachedValue?.transactionHashes)
    && Number.isFinite(cachedValue?.gasSpentEth)
  ) {
    const knownHashes = new Set(cachedValue.transactionHashes);
    const newHashes = uniqueHashes.filter((hash) => !knownHashes.has(hash));

    if (!newHashes.length) {
      gasSpentEth = cachedValue.gasSpentEth;
      source = cachedValue.source === 'on-chain-bake-receipts-exact'
        ? 'on-chain-bake-receipts-exact'
        : 'on-chain-bake-logs-approx';
    } else {
      gasSpentEth = cachedValue.gasSpentEth + (newHashes.length * feePerTx);
      source = 'on-chain-bake-logs-approx-incremental';
    }
  }

  return {
    transactionCount: uniqueHashes.length,
    gasSpentEth,
    averageFeeEth: feePerTx,
    source,
    transactionHashes: uniqueHashes,
  };
}

async function fetchBakeTxStats({ address, seasonId, seasonStartTime, rpcHttp, bakeryContract }) {
  const cacheKey = `${String(address).toLowerCase()}:${seasonId}`;
  const cached = checkStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAtMs <= CHECK_STATS_TTL_MS) {
    return cached.value;
  }

  const cachedValue = cached?.value ?? null;
  let transactionHashes = [];

  try {
    const logs = await fetchSeasonBakeLogs({ rpcHttp, bakeryContract, address, seasonId, seasonStartTime });
    transactionHashes = uniqueTransactionHashes(logs);
    let gasSpentEth = null;
    let averageFeeEth = null;
    let source = 'on-chain-bake-receipts-exact';

    if (
      cachedValue?.source === 'on-chain-bake-receipts-exact'
      && Array.isArray(cachedValue.transactionHashes)
      && Number.isFinite(cachedValue.gasSpentEth)
    ) {
      const knownHashes = new Set(cachedValue.transactionHashes);
      const newHashes = transactionHashes.filter((hash) => !knownHashes.has(hash));

      if (!newHashes.length) {
        gasSpentEth = cachedValue.gasSpentEth;
      } else {
        const incrementalFeeEth = await fetchTotalBakeFeeEth(rpcHttp, newHashes);
        gasSpentEth = cachedValue.gasSpentEth + incrementalFeeEth;
      }
    } else {
      gasSpentEth = await fetchTotalBakeFeeEth(rpcHttp, transactionHashes);
    }

    averageFeeEth = transactionHashes.length > 0 ? gasSpentEth / transactionHashes.length : bakeTxFeeEth();

    const value = {
      transactionCount: transactionHashes.length,
      gasSpentEth,
      averageFeeEth,
      source,
      transactionHashes,
    };

    checkStatsCache.set(cacheKey, {
      value,
      generatedAtMs: Date.now(),
    });
    return value;
  } catch (error) {
    if (!transactionHashes.length) {
      if (cached) return cached.value;
      throw error;
    }

    try {
      const averageFeeEth = await fetchAverageBakeFeeEth(rpcHttp, transactionHashes);
      const value = deriveApproxBakeTxStats({
        transactionHashes,
        cachedValue,
        averageFeeEth,
      });

      checkStatsCache.set(cacheKey, {
        value,
        generatedAtMs: Date.now(),
      });
      return value;
    } catch (fallbackError) {
      if (transactionHashes.length) {
        const value = deriveApproxBakeTxStats({
          transactionHashes,
          cachedValue,
        });

        checkStatsCache.set(cacheKey, {
          value,
          generatedAtMs: Date.now(),
        });
        return value;
      }
      if (cached) return cached.value;
      throw new Error(`${error.message}; exact gas fallback failed: ${fallbackError.message}`);
    }
  }
}

function estimateRewardForMember({ member, bakery, bakeryValue }) {
  const cookieScale = 10_000;
  const cookies = toNumber(member.txCount, 'member.txCount') / cookieScale;

  if (!bakeryValue) {
    return { cookies, rewardEth: 0, rewardUsd: null, isTopBakery: false };
  }

  const rewardEth = cookies > 0 ? (bakeryValue.ethPerThousandCookies / COOKIE_UNIT) * cookies : 0;
  const rewardUsd = bakeryValue.usdPerThousandCookies === null
    ? null
    : (bakeryValue.usdPerThousandCookies / COOKIE_UNIT) * cookies;

  return { cookies, rewardEth, rewardUsd, isTopBakery: true };
}

export function renderCheckReport({
  identity,
  profile,
  address,
  season,
  seasonStartTime,
  bakery,
  bakeryValue,
  member,
  txCount,
  gasSpentEth,
  gasSpentUsd,
  rewardEth,
  rewardUsd,
  netEth,
  netUsd,
  roiPercent,
  ethUsd,
}) {
  const name = profile?.name ?? identity;
  const cookies = toNumber(member.txCount, 'member.txCount') / 10_000;
  const lines = ['<b>Season Check</b>', ''];
  const gasCostText = gasSpentEth === null
    ? '<b>N/A</b>'
    : `<b>${formatEth(gasSpentEth, 5)} ETH</b>${gasSpentUsd === null ? '' : ` ($${formatNumber(gasSpentUsd, 0)})`}`;
  const rewardText = `<b>${formatEth(rewardEth, 4)} ETH</b>${rewardUsd === null ? '' : ` ($${formatNumber(rewardUsd, 0)})`}`;

  lines.push(`<b>${escapeHtml(name)}</b>`);
  lines.push(`${escapeHtml(shortAddress(address))}`);
  lines.push(`Clan: <b>${escapeHtml(bakery.name)}</b>${bakeryValue ? ' (top 5)' : ''}`);
  lines.push('');
  lines.push(`Cookies: <b>${compactCookies(cookies)}</b>`);
  lines.push(`Cook tx: <b>${txCount === null ? 'n/a' : formatNumber(txCount, 0)}</b>`);
  lines.push(`Gas cost: ${gasCostText}`);
  lines.push(`Est. reward: ${rewardText}`);

  if (gasSpentEth === null) {
    lines.push('Net ROI: <b>N/A</b>');
  } else if (roiPercent === null) {
    lines.push(`Net ROI: <b>${netEth >= 0 ? '+' : ''}${formatEth(netEth, 4)} ETH</b>${netUsd === null ? '' : ` ($${netUsd >= 0 ? '+' : ''}$${formatNumber(Math.abs(netUsd), 0)})`}`);
  } else {
    lines.push(`Net ROI: <b>${roiPercent >= 0 ? '+' : ''}${formatNumber(roiPercent, 1)}%</b>${netUsd === null ? '' : ` (${netUsd >= 0 ? '+' : '-'}$${formatNumber(Math.abs(netUsd), 0)})`}`);
  }

  lines.push('');
  if (seasonStartTime) lines.push(`Season started: ${formatMoscowDateTime(new Date(seasonStartTime * 1000))}`);
  lines.push(`Prize pool: ${formatEth(weiToEth(season.prizePool ?? season.finalizedPrizePool), 4)} ETH`);
  if (bakeryValue) {
    lines.push(`1,000 cookies in ${escapeHtml(bakery.name)}: ${formatEth(bakeryValue.ethPerThousandCookies, 6)} ETH`);
  } else {
    lines.push('Bakery payout: outside top 5 right now');
  }
  if (ethUsd) lines.push(`ETH/USD: $${formatNumber(ethUsd, 2)}`);

  return lines.join('\n');
}

function buildCheckCardData({
  identity,
  profile,
  address,
  season,
  seasonStartTime,
  bakery,
  bakeryValue,
  member,
  txCount,
  gasSpentEth,
  gasSpentUsd,
  rewardEth,
  rewardUsd,
  netUsd,
  roiPercent,
  ethUsd,
}) {
  const name = profile?.name ?? identity;
  const cookies = toNumber(member.txCount, 'member.txCount') / 10_000;
  const gasUnavailable = gasSpentEth === null;
  const roiValue = gasUnavailable || roiPercent === null ? 'N/A' : `${roiPercent >= 0 ? '+' : ''}${formatNumber(roiPercent, 1)}%`;
  const netUsdValue = gasUnavailable || netUsd === null ? null : `${netUsd >= 0 ? '+' : '-'}${formatUsdCompact(netUsd, 0)}`;
  const gasUsdValue = gasSpentUsd === null ? null : formatUsdCompact(gasSpentUsd, 0);
  const rewardUsdValue = rewardUsd === null ? null : formatUsdCompact(rewardUsd, 0);
  const oneKValue = bakeryValue ? `${formatEth(bakeryValue.ethPerThousandCookies, 6)} ETH` : 'OUTSIDE TOP 5';

  return {
    title: 'Season Check',
    name,
    address: shortAddress(address),
    clan: `Clan: ${bakery.name}${bakeryValue ? ' (top 5)' : ''}`,
    avatarUrl: profile?.profilePictureUrl ?? null,
    tiles: [
      {
        label: 'Cookies',
        value: compactCookies(cookies),
        accent: '#43e7c6',
        valueColor: '#f5f4d7',
      },
      {
        label: 'Cook tx',
        value: txCount === null ? 'N/A' : formatNumber(txCount, 0),
        accent: '#67c8ff',
        valueColor: '#f5f4d7',
      },
      {
        label: 'Gas cost',
        value: gasSpentEth === null ? 'N/A' : `${formatEth(gasSpentEth, 5)} ETH`,
        subvalue: gasUsdValue,
        accent: '#ff8e6e',
        valueColor: '#ffc5a5',
        subvalueColor: '#ffd8c7',
      },
      {
        label: 'Est reward',
        value: `${formatEth(rewardEth, 4)} ETH`,
        subvalue: rewardUsdValue,
        accent: '#ffd76a',
        valueColor: '#fff0aa',
        subvalueColor: '#ffeec4',
      },
      {
        label: 'Net ROI',
        value: roiValue,
        subvalue: netUsdValue,
        accent: roiPercent !== null && roiPercent >= 0 ? '#6df2a5' : '#ff7f73',
        valueColor: roiPercent !== null && roiPercent >= 0 ? '#b9ffd0' : '#ffb4a5',
        subvalueColor: roiPercent !== null && roiPercent >= 0 ? '#dbffe7' : '#ffd7cb',
      },
      {
        label: '1K value',
        value: oneKValue,
        subvalue: ethUsd ? `ETH/USD ${formatUsdCompact(ethUsd, 2)}` : null,
        accent: '#b27cff',
        valueColor: '#e9e2ff',
        subvalueColor: '#d7cef8',
      },
    ],
  };
}

export async function buildCheckReport(identity) {
  const index = await getCheckIndex();
  const address = await resolveAddressByIdentity(index, identity);

  if (!address) {
    return {
      ok: false,
      message: 'I could not find that username in the current season. Send the wallet address in the <code>0x...</code> format and I will check it directly.',
    };
  }

  let member = index.memberMap.get(address) ?? null;
  if (!member) {
    const chef = await findChefByAddress(index.baseUrl, index.season.id, address).catch(() => null);
    if (chef) {
      member = {
        seasonId: chef.seasonId ?? index.season.id,
        address,
        bakeryId: chef.bakeryId,
        txCount: chef.txCount,
        bakedTxCount: chef.bakedTxCount,
        effectiveTxCount: chef.effectiveTxCount,
        referralCount: chef.referralCount ?? 0,
        boostAttempts: chef.boostAttempts ?? 0,
        boostLanded: chef.boostLanded ?? 0,
        rugAttempts: chef.rugAttempts ?? 0,
        rugLanded: chef.rugLanded ?? 0,
      };
      index.memberMap.set(address, member);
      saveCheckIndexCache(index).catch(() => {});
    }
  }
  if (!member) {
    return {
      ok: false,
      message: 'I could not confirm this address in the active season through the public Rugpull indexes. Send the username or address again and I will retry.',
    };
  }

  const txStatsPromise = fetchBakeTxStats({
    address,
    seasonId: index.season.id,
    seasonStartTime: index.season?.startTime ?? index.seasonStartTime,
    rpcHttp: index.rpcHttp,
    bakeryContract: index.bakeryContract,
  });
  const bakeryPromise = index.bakeryMap.get(member.bakeryId)
    ? Promise.resolve(index.bakeryMap.get(member.bakeryId))
    : fetchBakeryById(index.baseUrl, member.bakeryId, index.season.id);
  const profilePromise = index.profileMap.get(address)
    ? Promise.resolve(index.profileMap.get(address))
    : fetchProfilesByAddresses(index.baseUrl, [address]).catch(() => []);

  const [bakery, profileLookup, txStats] = await Promise.all([
    bakeryPromise.catch((error) => {
      console.warn(`Could not fetch bakery for /ch (${member.bakeryId}): ${error.message}`);
      return index.bakeryMap.get(member.bakeryId) ?? {
        id: member.bakeryId,
        name: 'Unknown bakery',
      };
    }),
    profilePromise,
    txStatsPromise.catch((error) => {
      console.warn(`Could not fetch on-chain bake tx stats for /ch (${address}): ${error.message}`);
      return {
        transactionCount: null,
        averageFeeEth: null,
        source: 'unavailable',
      };
    }),
  ]);

  const bakeryValue = index.bakeryValueMap.get(bakery.name) ?? null;
  let profile = index.profileMap.get(address) ?? null;
  if (!profile && Array.isArray(profileLookup)) {
    const fetched = profileLookup[0];
    if (fetched) {
      profile = fetched.profile ?? null;
      index.profileMap.set(address, profile);
      if (profile?.name) {
        index.profileNameMap.set(normalizeName(profile.name), address);
      }
      saveCheckIndexCache(index).catch(() => {});
    }
  } else if (!profile && profileLookup && !Array.isArray(profileLookup)) {
    profile = profileLookup;
  }
  const reward = estimateRewardForMember({ member, bakery, bakeryValue });

  const txCount = txStats.transactionCount;
  const gasFeeEth = txStats.averageFeeEth ?? bakeTxFeeEth();
  const gasSpentEth = Number.isFinite(txStats.gasSpentEth)
    ? txStats.gasSpentEth
    : (txCount === null ? null : txCount * gasFeeEth);
  const gasSpentUsd = gasSpentEth === null || index.ethUsd === null ? null : gasSpentEth * index.ethUsd;
  const netEth = gasSpentEth === null ? reward.rewardEth : reward.rewardEth - gasSpentEth;
  const netUsd = reward.rewardUsd === null || gasSpentUsd === null ? null : reward.rewardUsd - gasSpentUsd;
  const roiPercent = gasSpentEth && gasSpentEth > 0 ? (netEth / gasSpentEth) * 100 : null;

  return {
    ok: true,
    cardData: buildCheckCardData({
      identity,
      profile,
      address,
      season: index.season,
      seasonStartTime: index.seasonStartTime,
      bakery,
      bakeryValue,
      member,
      txCount,
      gasSpentEth,
      gasSpentUsd,
      rewardEth: reward.rewardEth,
      rewardUsd: reward.rewardUsd,
      netUsd,
      roiPercent,
      ethUsd: index.ethUsd,
    }),
    text: renderCheckReport({
      identity,
      profile,
      address,
      season: index.season,
      seasonStartTime: index.seasonStartTime,
      bakery,
      bakeryValue,
      member,
      txCount,
      gasSpentEth,
      gasSpentUsd,
      rewardEth: reward.rewardEth,
      rewardUsd: reward.rewardUsd,
      netEth,
      netUsd,
      roiPercent,
      ethUsd: index.ethUsd,
    }),
  };
}

async function buildReport() {
  const { agent, season, bakeries } = await withBaseUrlFallback(async (baseUrl) => {
    const [resolvedAgent, resolvedSeason, resolvedBakeries] = await Promise.all([
      fetchAgent(baseUrl).catch((error) => {
        console.warn(`Could not fetch agent.json, using default cookie scale: ${error.message}`);
        return { liveState: { gameplayCaps: { cookieScale: 10000 } } };
      }),
      fetchActiveSeason(baseUrl),
      fetchTopBakeries(baseUrl),
    ]);

    return {
      agent: resolvedAgent,
      season: resolvedSeason,
      bakeries: resolvedBakeries,
    };
  });
  const ethUsd = await fetchEthUsd();

  const values = calculateCookieValues({ agent, season, bakeries, ethUsd });
  return renderValueReport({ values, season, ethUsd, generatedAt: new Date() });
}

async function refreshReportCache() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = buildReport()
    .then(async (text) => {
      const cache = { text, generatedAtMs: Date.now() };
      reportCache = cache;
      await saveReportCache(cache);
      return cache;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

function refreshReportCacheInBackground(force = false) {
  if (!force && isCacheFresh(reportCache)) return;

  refreshReportCache().catch((error) => {
    console.warn(`Could not refresh report cache: ${error.message}`);
  });
}

async function telegramRequest(method, payload) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? response.statusText}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

async function telegramMultipartRequest(method, fields) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Blob) {
      form.set(key, value, value.name ?? 'upload.bin');
      continue;
    }
    if (typeof value === 'object' && !(value instanceof String)) {
      form.set(key, JSON.stringify(value));
      continue;
    }
    form.set(key, String(value));
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: form,
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? response.statusText}`);
  }
  return data.result;
}

async function sendPhoto(chatId, photoBuffer, filename, extra = {}) {
  const photo = new Blob([photoBuffer], { type: 'image/png' });
  Object.defineProperty(photo, 'name', {
    value: filename,
    configurable: true,
  });

  return telegramMultipartRequest('sendPhoto', {
    chat_id: chatId,
    photo,
    ...extra,
  });
}

async function deleteMessage(chatId, messageId) {
  return telegramRequest('deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function sendChatAction(chatId, action = 'typing') {
  return telegramRequest('sendChatAction', {
    chat_id: chatId,
    action,
  });
}

async function sendChatActionSafely(chatId, action = 'typing') {
  try {
    await sendChatAction(chatId, action);
  } catch (error) {
    console.warn(`Could not send chat action: ${error.message}`);
  }
}

async function sendProgressMessage(chatId) {
  try {
    return await sendMessage(chatId, '<i>Thinking...</i>');
  } catch (error) {
    console.warn(`Could not send progress message: ${error.message}`);
    return null;
  }
}

async function sendCheckResult(chatId, result, extra = {}) {
  if (!result?.cardData) {
    await sendMessage(chatId, result.text, extra);
    return;
  }

  try {
    const photoBuffer = await renderStatCardPng(result.cardData);
    await sendChatActionSafely(chatId, 'upload_photo');
    await sendPhoto(chatId, photoBuffer, 'season-check.png', extra);
  } catch (error) {
    console.warn(`Could not render/send stat card: ${error.message}`);
    await sendMessage(chatId, result.text, extra);
  }
}

async function deleteProgressMessage(chatId, progressMessage) {
  if (!progressMessage?.message_id) return;
  try {
    await deleteMessage(chatId, progressMessage.message_id);
  } catch (error) {
    console.warn(`Could not delete progress message: ${error.message}`);
  }
}

export function isValueCommand(text) {
  if (!text) return false;
  const { command } = parseCommandText(text);
  return ['/cookie', '/cookies', '/value', '/price'].includes(command);
}

export function isHelpCommand(text) {
  if (!text) return false;
  const { command } = parseCommandText(text);
  return ['/start', '/help'].includes(command);
}

export function isCheckCommand(text) {
  if (!text) return false;
  const { command } = parseCommandText(text);
  return command === '/ch';
}

export function isHiddenStatsCommand(text) {
  if (!text) return false;
  const { command } = parseCommandText(text);
  return command === HIDDEN_STATS_COMMAND;
}

async function sendWelcomeMessage(chatId) {
  refreshReportCacheInBackground();
  refreshCheckIndexInBackground();
  await sendMessage(chatId, renderWelcomeMessage());
}

async function sendHiddenStats(chatId) {
  await loadKnownChats();
  const stats = countKnownChats();
  await sendMessage(chatId, renderHiddenStatsMessage(stats));
}

async function broadcastMessageToKnownChats(text) {
  await loadKnownChats();

  const chatIds = [...knownChats];
  let sent = 0;
  let failed = 0;

  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn(`Could not broadcast to ${chatId}: ${error.message}`);
    }
  }

  return {
    total: chatIds.length,
    sent,
    failed,
  };
}

async function sendValueReport(chatId) {
  try {
    sendChatActionSafely(chatId);

    if (isCacheFresh(reportCache)) {
      await sendMessage(chatId, reportCache.text);
      refreshReportCacheInBackground();
      return;
    }

    if (isCacheUsable(reportCache)) {
      await sendMessage(chatId, `${reportCache.text}\n\n<i>Refreshing live data in the background.</i>`);
      refreshReportCacheInBackground();
      return;
    }

    const cache = await refreshReportCache();
    await sendMessage(chatId, cache.text);
  } catch (error) {
    console.error(error);
    const message = reportCache?.text
      ? `${reportCache.text}\n\n<i>Live refresh failed, showing the latest cached report.</i>`
      : 'Could not calculate cookie value right now. Please try again in a few seconds.';
    await sendMessage(chatId, message);
  }
}

async function sendCheckPrompt(chatId, userId, chat, sourceMessageId) {
  refreshCheckIndexInBackground();
  const group = isGroupChat(chat);
  const promptText = group
    ? 'Reply to this message with the Rugpull Bakery username or the wallet address in the <code>0x...</code> format. I will show profit/loss.'
    : 'Send the Rugpull Bakery username or the wallet address in the <code>0x...</code> format. I will show profit/loss.';
  const promptMessage = await sendMessage(chatId, promptText, {
    reply_to_message_id: sourceMessageId,
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: 'username or 0x...',
    },
  });

  checkSessions.set(makeCheckSessionKey(chatId, userId), {
    awaitingIdentity: true,
    userId,
    chatId,
    promptMessageId: promptMessage?.message_id ?? null,
    sourceMessageId,
    isGroup: group,
    createdAtMs: Date.now(),
  });
}

async function handleCheckIdentity(chatId, userId, identity, session = null) {
  const normalizedIdentity = String(identity).trim().toLowerCase();
  const cached = checkReportCache.get(normalizedIdentity);
  if (cached && Date.now() - cached.generatedAtMs <= CHECK_REPORT_TTL_MS) {
    if (session) checkSessions.delete(makeCheckSessionKey(chatId, userId));
    await sendCheckResult(chatId, cached.result);
    return;
  }

  const progressMessagePromise = sendProgressMessage(chatId);
  try {
    sendChatActionSafely(chatId);
    let resultPromise = checkReportInFlight.get(normalizedIdentity);
    if (!resultPromise) {
      resultPromise = buildCheckReport(identity).finally(() => {
        checkReportInFlight.delete(normalizedIdentity);
      });
      checkReportInFlight.set(normalizedIdentity, resultPromise);
    }
    const result = await resultPromise;
    const progressMessage = await progressMessagePromise;
    await deleteProgressMessage(chatId, progressMessage);
    if (!result.ok) {
      if (session) {
        const retryPrompt = await sendMessage(chatId, `${result.message}\n\n<i>Reply to this message and try again.</i>`, {
          reply_to_message_id: session.promptMessageId ?? session.sourceMessageId,
          reply_markup: session.isGroup
            ? {
                force_reply: true,
                selective: true,
                input_field_placeholder: 'username or 0x...',
              }
            : undefined,
        });
        checkSessions.set(makeCheckSessionKey(chatId, userId), {
          ...session,
          promptMessageId: retryPrompt?.message_id ?? session.promptMessageId,
          createdAtMs: Date.now(),
        });
      } else {
        await sendMessage(chatId, result.message);
      }
      return;
    }

    if (session) checkSessions.delete(makeCheckSessionKey(chatId, userId));
    checkReportCache.set(normalizedIdentity, {
      result,
      generatedAtMs: Date.now(),
    });
    await sendCheckResult(chatId, result);
  } catch (error) {
    console.error(error);
    const progressMessage = await progressMessagePromise;
    await deleteProgressMessage(chatId, progressMessage);
    await sendMessage(chatId, 'I could not calculate /ch right now. Please try again in a few seconds.');
  }
}

async function handleUpdate(update) {
  const message = update.message;
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const text = message?.text?.trim();
  if (!chatId || !userId || !text) return;

  await registerChat(chatId);

  if (isHelpCommand(text)) {
    await sendWelcomeMessage(chatId);
    return;
  }

  if (isValueCommand(text)) {
    await sendValueReport(chatId);
    return;
  }

  if (isHiddenStatsCommand(text)) {
    await sendHiddenStats(chatId);
    return;
  }

  if (isCheckCommand(text)) {
    const { argument } = parseCommandText(text);
    if (argument) {
      await handleCheckIdentity(chatId, userId, argument);
      return;
    }

    await sendCheckPrompt(chatId, userId, message.chat, message.message_id);
    return;
  }

  const session = cleanExpiredCheckSession(chatId, userId);
  if (session?.awaitingIdentity && shouldAcceptCheckIdentityMessage(session, message)) {
    await handleCheckIdentity(chatId, userId, text, session);
  }
}

async function pollingLoop() {
  let offset = 0;
  const interval = toNumber(env('POLL_INTERVAL_MS', '1200'), 'POLL_INTERVAL_MS');
  const maxConcurrentUpdates = toNumber(
    env('MAX_CONCURRENT_UPDATES', String(DEFAULT_MAX_CONCURRENT_UPDATES)),
    'MAX_CONCURRENT_UPDATES',
  );
  const maxScheduledUpdates = toNumber(
    env('MAX_SCHEDULED_UPDATES', String(DEFAULT_MAX_SCHEDULED_UPDATES)),
    'MAX_SCHEDULED_UPDATES',
  );
  const scheduler = createConversationScheduler(maxConcurrentUpdates);
  const inFlightUpdates = new Set();

  await acquireBotLock();
  await loadReportCache();
  await loadCheckIndexCache();
  await loadKnownChats();
  await loadBaselineKnownChats();
  refreshReportCacheInBackground();
  refreshCheckIndexInBackground();
  setInterval(refreshReportCacheInBackground, CACHE_TTL_MS).unref();
  setInterval(refreshCheckIndexInBackground, CHECK_INDEX_TTL_MS).unref();

  console.log('Rugpull Bakery Telegram bot is polling.');
  for (;;) {
    try {
      const updates = await telegramRequest('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message'],
      });

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        if (!shouldProcessUpdate(update)) continue;
        const trackedPromise = scheduler
          .schedule(conversationKeyForUpdate(update), () => handleUpdate(update))
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            inFlightUpdates.delete(trackedPromise);
          });

        inFlightUpdates.add(trackedPromise);

        if (inFlightUpdates.size >= maxScheduledUpdates) {
          await Promise.race(inFlightUpdates);
        }
      }
    } catch (error) {
      console.error(error);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

  if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cleanup = () => {
    releaseBotLock().catch(() => {});
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  if (process.argv.includes('--once')) {
    refreshReportCache().then((cache) => console.log(cache.text)).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else if (process.argv.includes('--broadcast')) {
    const text = env('BROADCAST_TEXT');
    if (!text) {
      console.error('BROADCAST_TEXT is required for --broadcast');
      process.exitCode = 1;
    } else {
      broadcastMessageToKnownChats(text)
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
    }
  } else {
    pollingLoop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
