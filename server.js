'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const { google } = require('googleapis');
const MAP_LAYOUT = require('./public/map-layout');

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
const OFFICE_PASSWORD = process.env.OFFICE_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ROOM_CHAT_SPACE = process.env.ROOM_CHAT_SPACE || '';

if (!CLIENT_ID || !CLIENT_SECRET || !OFFICE_PASSWORD || !SESSION_SECRET) {
  throw new Error('Eksik ortam değişkeni. .env.example dosyasını doldurun.');
}
if (SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET en az 32 karakter olmalıdır.');
}
if (process.env.VERCEL && !process.env.REDIS_URL) {
  throw new Error('Vercel dağıtımı için REDIS_URL ortam değişkeni gereklidir.');
}

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.readonly'
];

const WORLD = MAP_LAYOUT.WORLD;
const OFFICE = MAP_LAYOUT.OFFICE;
const COFFEE_STATION = MAP_LAYOUT.COFFEE_STATION;
const COFFEE_DRINK_DURATION_MS = 3600;
const MEETING_ROOMS = MAP_LAYOUT.ROOMS.map((room) => ({
  ...room,
  meetUrl: process.env[`ROOM${room.id}_MEET_URL`] || (room.id === 1 ? process.env.ROOM_MEET_URL : '') || ''
}));
const configuredMeetUrls = MEETING_ROOMS.map((room) => room.meetUrl).filter(Boolean);
if (new Set(configuredMeetUrls).size !== configuredMeetUrls.length) {
  throw new Error('Her toplantı odası için farklı bir ROOMn_MEET_URL kullanın.');
}
const PROXIMITY = 100;
const PROFILE_FILE = path.join(__dirname, 'data', 'characters.json');
const HAIR_STYLES = new Set(['short', 'long', 'bun', 'cap']);
const ACCESSORIES = new Set(['none', 'glasses']);
const CHARACTER_PRESETS = [
  { modelId: 'business-man', bodyColor: '#d95763', skinColor: '#e8b58f', hairColor: '#49332e', hairStyle: 'short', accessory: 'none' },
  { modelId: 'woman-casual', bodyColor: '#4b89a5', skinColor: '#f0c49b', hairColor: '#382b29', hairStyle: 'long', accessory: 'glasses' },
  { modelId: 'woman', bodyColor: '#6b9b66', skinColor: '#c98d67', hairColor: '#6a432d', hairStyle: 'bun', accessory: 'none' },
  { modelId: 'man-in-suit', bodyColor: '#9074b5', skinColor: '#e9c6a9', hairColor: '#d1a153', hairStyle: 'cap', accessory: 'none' },
  { modelId: 'woman-dress', bodyColor: '#c18a48', skinColor: '#9e654d', hairColor: '#302726', hairStyle: 'short', accessory: 'glasses' },
  { modelId: 'worker', bodyColor: '#ce6d99', skinColor: '#edc6a2', hairColor: '#76513d', hairStyle: 'long', accessory: 'none' },
  { modelId: 'business-man', bodyColor: '#538b77', skinColor: '#d89d77', hairColor: '#292626', hairStyle: 'cap', accessory: 'glasses' },
  { modelId: 'woman-casual', bodyColor: '#7188c4', skinColor: '#f0d1ad', hairColor: '#814b36', hairStyle: 'bun', accessory: 'none' }
];
const CHARACTER_MODEL_IDS = new Set([
  'business-man',
  'man-in-suit',
  'woman-dress',
  'woman-casual',
  'woman',
  'worker'
]);

function modelForUser(userId) {
  const hash = crypto.createHash('sha256').update(userId).digest();
  return CHARACTER_PRESETS[hash.readUInt32LE(0) % CHARACTER_PRESETS.length].modelId;
}

function validateCharacter(value, fallbackModelId = 'business-man') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const colorPattern = /^#[0-9a-f]{6}$/i;
  const colors = [value.bodyColor, value.skinColor, value.hairColor];
  const modelId = value.modelId === undefined ? fallbackModelId : value.modelId;
  if (!colors.every((color) => typeof color === 'string' && colorPattern.test(color)) ||
      typeof modelId !== 'string' || !CHARACTER_MODEL_IDS.has(modelId) ||
      !HAIR_STYLES.has(value.hairStyle) ||
      !ACCESSORIES.has(value.accessory)) {
    return null;
  }
  return {
    modelId,
    bodyColor: value.bodyColor.toLowerCase(),
    skinColor: value.skinColor.toLowerCase(),
    hairColor: value.hairColor.toLowerCase(),
    hairStyle: value.hairStyle,
    accessory: value.accessory
  };
}

function readCharacterProfiles() {
  try {
    const saved = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error('Kayıt dosyası nesne biçiminde olmalıdır.');
    }
    return Object.fromEntries(Object.entries(saved).map(([userId, value]) => {
      const character = validateCharacter(value, modelForUser(userId));
      if (!userId || !character) throw new Error(`Geçersiz karakter profili: ${userId}`);
      return [userId, character];
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Karakter profilleri yüklenemedi: ${error.message}`);
  }
}

let characterProfiles = readCharacterProfiles();
let profileVersion = 0;
let persistedProfileVersion = 0;
let profileSaveQueue = Promise.resolve();

function characterSignature(character) {
  return [
    character.modelId,
    character.bodyColor,
    character.skinColor,
    character.hairColor,
    character.hairStyle,
    character.accessory
  ].join('|');
}

function createDefaultCharacter() {
  const used = new Set(Object.values(characterProfiles).map(characterSignature));
  const unusedPreset = CHARACTER_PRESETS.find((preset) => !used.has(characterSignature(preset)));
  if (unusedPreset) return { ...unusedPreset };

  const styles = Array.from(HAIR_STYLES);
  const accessories = Array.from(ACCESSORIES);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const character = {
      modelId: CHARACTER_PRESETS[crypto.randomInt(CHARACTER_PRESETS.length)].modelId,
      bodyColor: `#${crypto.randomBytes(3).toString('hex')}`,
      skinColor: `#${crypto.randomBytes(3).toString('hex')}`,
      hairColor: `#${crypto.randomBytes(3).toString('hex')}`,
      hairStyle: styles[crypto.randomInt(styles.length)],
      accessory: accessories[crypto.randomInt(accessories.length)]
    };
    if (!used.has(characterSignature(character))) return character;
  }
  throw new Error('Benzersiz varsayılan karakter oluşturulamadı.');
}

function persistCharacterProfiles() {
  const version = profileVersion;
  if (redisClient) {
    const saved = Object.fromEntries(Object.entries(characterProfiles)
      .map(([userId, character]) => [userId, JSON.stringify(character)]));
    const operation = profileSaveQueue.then(async () => {
      if (Object.keys(saved).length) await redisClient.hSet(sharedStateKeys.profiles, saved);
      persistedProfileVersion = Math.max(persistedProfileVersion, version);
    });
    profileSaveQueue = operation.catch((error) => {
      console.error('Karakter profilleri Redis kaydı başarısız:', error.message);
    });
    return operation;
  }

  const content = JSON.stringify(characterProfiles, null, 2);
  const operation = profileSaveQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(PROFILE_FILE), { recursive: true });
    const temporaryFile = `${PROFILE_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryFile, content, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temporaryFile, PROFILE_FILE);
    persistedProfileVersion = Math.max(persistedProfileVersion, version);
  });
  profileSaveQueue = operation.catch((error) => {
    console.error('Karakter profilleri kaydedilemedi:', error.message);
  });
  return operation;
}

async function getCharacterProfile(userId) {
  if (!characterProfiles[userId]) {
    characterProfiles[userId] = createDefaultCharacter();
    profileVersion += 1;
  }
  if (persistedProfileVersion < profileVersion) await persistCharacterProfiles();
  return { ...characterProfiles[userId] };
}

const app = express();
const server = require('node:http').createServer(app);
const io = new Server(server, {
  path: '/api/socket',
  addTrailingSlash: false,
  transports: ['websocket']
});
const players = new Map();
const pairSessions = new Map();
const roomLocks = new Set();
const seatReservations = new Map();
const localSocketIds = new Set();
const instanceId = crypto.randomUUID();
const sharedStateChannel = 'gather:office:state';
const sharedStateKeys = {
  players: 'gather:office:players',
  pairs: 'gather:office:pairs',
  locks: 'gather:office:room-locks',
  seats: 'gather:office:seats',
  profiles: 'gather:office:profiles'
};
const redisClient = process.env.REDIS_URL
  ? createClient({ url: process.env.REDIS_URL })
  : null;
const redisPubClient = redisClient?.duplicate() || null;
const redisSubClient = redisClient?.duplicate() || null;
const redisSessionStore = redisClient
  ? new RedisStore({ client: redisClient, prefix: 'gather:sess:' })
  : undefined;
let redisReady = Promise.resolve();
for (const client of [redisClient, redisPubClient, redisSubClient]) {
  client?.on('error', (error) => console.error('Redis bağlantı hatası:', error.message));
}
const sessionMiddleware = session({
  name: 'gather.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: redisSessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
});

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  if (process.env.VERCEL) {
    const requestPath = req.url.split('?')[0];
    const routeAliases = {
      '/api/auth-google': '/auth/google',
      '/api/auth-google-callback': '/auth/google/callback',
      '/api/chat-messages': '/api/chat/messages'
    };
    const targetPath = routeAliases[requestPath];
    if (targetPath) req.url = `${targetPath}${req.url.slice(requestPath.length)}`;
  }
  next();
});
app.use((req, res, next) => {
  redisReady.then(() => next()).catch(next);
});
app.use(sessionMiddleware);
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' }
});

function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function requireAuthenticated(req, res, next) {
  if (!req.session.authenticated || !req.session.googleTokens) {
    return res.status(401).json({ error: 'Önce Google ile giriş yapın.' });
  }
  next();
}

function googleClientFor(sessionData) {
  const client = createOAuthClient();
  client.setCredentials(sessionData.googleTokens);
  client.on('tokens', (tokens) => {
    sessionData.googleTokens = { ...sessionData.googleTokens, ...tokens };
    sessionData.save((error) => {
      if (error) console.error('Oturum token yenileme kaydedilemedi:', error.message);
    });
  });
  return client;
}

function getChatApi(sessionData) {
  return google.chat({ version: 'v1', auth: googleClientFor(sessionData) });
}

function errorMessage(error) {
  return error.response?.data?.error?.message || error.message || 'Google API isteği başarısız oldu.';
}

function serializablePlayer(player) {
  return {
    id: player.id,
    userId: player.userId,
    email: player.email,
    name: player.name,
    character: player.character,
    sessionID: player.sessionID,
    x: player.x,
    y: player.y,
    direction: player.direction,
    moving: player.moving,
    seatId: player.seatId,
    sitting: player.sitting,
    sitStartedAt: player.sitStartedAt,
    drinkingCoffee: player.drinkingCoffee,
    coffeeStartedAt: player.coffeeStartedAt,
    lastSeenAt: player.lastSeenAt
  };
}

function serializablePair(pair) {
  return {
    ...pair,
    pendingInvite: pair.pendingInvite
      ? { ...pair.pendingInvite, timeout: undefined }
      : null
  };
}

function hydratePlayer(state) {
  const current = players.get(state.id);
  if (current && localSocketIds.has(state.id)) {
    Object.assign(current, state);
    return current;
  }
  return {
    ...state,
    session: null,
    coffeeTimer: null,
    lastMoveAt: 0,
    lastRoomLockAt: 0,
    lastLockedNoticeAt: 0,
    lastPairMessageAt: 0,
    lastSharedStateAt: state.lastSeenAt || 0
  };
}

function hydratePair(state, current = pairSessions.get(state.key)) {
  const pendingInvite = state.pendingInvite
    ? {
        ...state.pendingInvite,
        timeout: current?.pendingInvite?.id === state.pendingInvite.id
          ? current.pendingInvite.timeout
          : null
      }
    : null;
  return { ...state, pendingInvite };
}

async function publishSharedState(type, data) {
  if (!redisClient) return;
  await redisClient.publish(sharedStateChannel, JSON.stringify({
    origin: instanceId,
    type,
    data
  }));
}

async function persistPlayerState(player, force = false) {
  if (!redisClient) return;
  const now = Date.now();
  if (!force && now - (player.lastSharedStateAt || 0) < 100) return;
  player.lastSharedStateAt = now;
  player.lastSeenAt = now;
  const state = serializablePlayer(player);
  await redisClient.hSet(sharedStateKeys.players, player.id, JSON.stringify(state));
  await publishSharedState('player-upsert', state);
}

async function removePlayerState(playerId) {
  if (!redisClient) return;
  await redisClient.hDel(sharedStateKeys.players, playerId);
  await publishSharedState('player-delete', { id: playerId });
}

async function persistPair(pair) {
  if (!redisClient) return;
  const state = serializablePair(pair);
  await redisClient.hSet(sharedStateKeys.pairs, pair.key, JSON.stringify(state));
  await publishSharedState('pair-upsert', state);
}

async function removePairState(pairKeyValue) {
  if (!redisClient) return;
  await redisClient.hDel(sharedStateKeys.pairs, pairKeyValue);
  await redisClient.del(`gather:office:pair-create:${pairKeyValue}`);
  await publishSharedState('pair-delete', { key: pairKeyValue });
}

async function reserveSharedSeat(seatId, playerId) {
  if (!redisClient) return !seatReservations.has(seatId);
  let reserved = await redisClient.hSetNX(sharedStateKeys.seats, seatId, playerId);
  if (!reserved) {
    const currentPlayerId = await redisClient.hGet(sharedStateKeys.seats, seatId);
    const currentPlayerRaw = currentPlayerId
      ? await redisClient.hGet(sharedStateKeys.players, currentPlayerId)
      : null;
    const currentPlayer = currentPlayerRaw ? JSON.parse(currentPlayerRaw) : null;
    if (!currentPlayer || Date.now() - currentPlayer.lastSeenAt > 120000) {
      await redisClient.hDel(sharedStateKeys.seats, seatId);
      reserved = await redisClient.hSetNX(sharedStateKeys.seats, seatId, playerId);
    }
  }
  if (reserved) {
    seatReservations.set(seatId, playerId);
    await publishSharedState('seat-upsert', { seatId, playerId });
  }
  return Boolean(reserved);
}

async function releaseSharedSeat(seatId, playerId) {
  if (!seatId) return;
  if (redisClient) {
    const occupantId = await redisClient.hGet(sharedStateKeys.seats, seatId);
    if (occupantId === playerId) {
      await redisClient.hDel(sharedStateKeys.seats, seatId);
      await publishSharedState('seat-delete', { seatId, playerId });
    }
  }
  if (seatReservations.get(seatId) === playerId) seatReservations.delete(seatId);
}

async function setSharedRoomLock(roomId, locked) {
  if (locked) roomLocks.add(roomId);
  else roomLocks.delete(roomId);
  if (!redisClient) return;
  if (locked) await redisClient.sAdd(sharedStateKeys.locks, String(roomId));
  else await redisClient.sRem(sharedStateKeys.locks, String(roomId));
  await publishSharedState('room-lock', { roomId, locked });
}

async function toggleSharedRoomLock(roomId) {
  if (!redisClient) {
    const locked = !roomLocks.has(roomId);
    await setSharedRoomLock(roomId, locked);
    return locked;
  }
  const locked = Boolean(await redisClient.eval(
    "if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return redis.call('SREM', KEYS[1], ARGV[1]) else return redis.call('SADD', KEYS[1], ARGV[1]) end",
    { keys: [sharedStateKeys.locks], arguments: [String(roomId)] }
  ));
  if (locked) roomLocks.add(roomId);
  else roomLocks.delete(roomId);
  await publishSharedState('room-lock', { roomId, locked });
  return locked;
}

async function refreshSharedState() {
  if (!redisClient) return;
  const [playerEntries, pairEntries, lockedRoomIds, seatEntries, profiles] = await Promise.all([
    redisClient.hGetAll(sharedStateKeys.players),
    redisClient.hGetAll(sharedStateKeys.pairs),
    redisClient.sMembers(sharedStateKeys.locks),
    redisClient.hGetAll(sharedStateKeys.seats),
    redisClient.hGetAll(sharedStateKeys.profiles)
  ]);
  const activePlayerIds = new Set();
  const expiredPlayerIds = [];
  for (const [playerId, raw] of Object.entries(playerEntries)) {
    const state = JSON.parse(raw);
    if (!state.lastSeenAt || Date.now() - state.lastSeenAt > 120000) {
      expiredPlayerIds.push(playerId);
      continue;
    }
    activePlayerIds.add(playerId);
    players.set(playerId, hydratePlayer(state));
  }
  for (const playerId of expiredPlayerIds) {
    await redisClient.hDel(sharedStateKeys.players, playerId);
    if (!localSocketIds.has(playerId)) players.delete(playerId);
    await publishSharedState('player-delete', { id: playerId });
  }
  for (const [playerId] of players) {
    if (!localSocketIds.has(playerId) && !activePlayerIds.has(playerId)) players.delete(playerId);
  }

  const existingPairs = new Map(pairSessions);
  pairSessions.clear();
  for (const [key, raw] of Object.entries(pairEntries)) {
    const pair = hydratePair(JSON.parse(raw), existingPairs.get(key));
    if (pair.userIds.every((playerId) => activePlayerIds.has(playerId))) {
      pairSessions.set(key, pair);
    } else {
      await redisClient.hDel(sharedStateKeys.pairs, key);
    }
  }

  roomLocks.clear();
  for (const roomId of lockedRoomIds) {
    const numericRoomId = Number(roomId);
    const occupied = Array.from(players.values()).some((player) => roomFor(player)?.id === numericRoomId);
    if (occupied) roomLocks.add(numericRoomId);
    else {
      await redisClient.sRem(sharedStateKeys.locks, roomId);
      await publishSharedState('room-lock', { roomId: numericRoomId, locked: false });
    }
  }
  seatReservations.clear();
  for (const [seatId, playerId] of Object.entries(seatEntries)) {
    if (activePlayerIds.has(playerId)) seatReservations.set(seatId, playerId);
    else await redisClient.hDel(sharedStateKeys.seats, seatId);
  }

  for (const [userId, raw] of Object.entries(profiles)) {
    const character = validateCharacter(JSON.parse(raw), modelForUser(userId));
    if (character) {
      characterProfiles[userId] = character;
      for (const player of players.values()) {
        if (player.userId === userId) player.character = { ...character };
      }
    }
  }
  persistedProfileVersion = profileVersion;
}

async function handleSharedStateMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (error) {
    console.error('Paylaşılan durum mesajı okunamadı:', error.message);
    return;
  }
  if (message.origin === instanceId) return;

  const { type, data } = message;
  if (type === 'player-upsert') {
    const current = players.get(data.id);
    if (current?.lastSeenAt > data.lastSeenAt) return;
    players.set(data.id, hydratePlayer(data));
    broadcastPlayers();
    updatePairs().catch((error) => console.error('Yakınlık durumu güncellenemedi:', error.message));
  } else if (type === 'player-delete') {
    players.delete(data.id);
    for (const [seatId, playerId] of seatReservations) {
      if (playerId === data.id) seatReservations.delete(seatId);
    }
    broadcastPlayers();
    updatePairs().catch((error) => console.error('Yakınlık durumu güncellenemedi:', error.message));
  } else if (type === 'pair-upsert') {
    pairSessions.set(data.key, hydratePair(data));
    notifyContexts();
  } else if (type === 'pair-delete') {
    pairSessions.delete(data.key);
    notifyContexts();
  } else if (type === 'room-lock') {
    if (data.locked) roomLocks.add(Number(data.roomId));
    else roomLocks.delete(Number(data.roomId));
    broadcastRoomLocks();
    notifyContexts();
  } else if (type === 'seat-upsert') {
    seatReservations.set(data.seatId, data.playerId);
  } else if (type === 'seat-delete') {
    if (seatReservations.get(data.seatId) === data.playerId) seatReservations.delete(data.seatId);
  } else if (type === 'profile-upsert') {
    characterProfiles[data.userId] = data.character;
    for (const player of players.values()) {
      if (player.userId === data.userId) player.character = { ...data.character };
    }
    broadcastPlayers();
  }
}

function roomFor(player) {
  return MEETING_ROOMS.find((room) =>
    player.x >= room.x &&
    player.x <= room.x + room.width &&
    player.y >= room.y &&
    player.y <= room.y + room.height
  ) || null;
}

function isInRoom(player) {
  return roomFor(player) !== null;
}

function getRoomLockState() {
  return Object.fromEntries(MEETING_ROOMS.map((room) => [room.id, roomLocks.has(room.id)]));
}

function unlockRoomIfEmpty(roomId) {
  if (!roomId || !roomLocks.has(roomId)) return false;
  const stillOccupied = Array.from(players.values()).some((player) => roomFor(player)?.id === roomId);
  if (stillOccupied) return false;
  roomLocks.delete(roomId);
  return true;
}

function canPlayerOccupy(player, originRoom, x, y, onLockedEntry) {
  if (MAP_LAYOUT.isBlocked(x, y)) return false;
  const destinationRoom = roomFor({ x, y });
  if (destinationRoom && destinationRoom.id !== originRoom?.id && roomLocks.has(destinationRoom.id)) {
    if (onLockedEntry) onLockedEntry(destinationRoom);
    return false;
  }
  return true;
}

function findSpawnPoint() {
  const existingPlayers = Array.from(players.values());
  for (let y = 100; y < OFFICE.y + OFFICE.height - 20; y += 36) {
    for (let x = OFFICE.x + 30; x < OFFICE.x + OFFICE.width - 20; x += 36) {
      if (MAP_LAYOUT.isBlocked(x, y)) continue;
      if (existingPlayers.some((player) => Math.hypot(player.x - x, player.y - y) < 34)) continue;
      return { x, y };
    }
  }
  throw new Error('Ofiste uygun başlangıç noktası bulunamadı.');
}

function findSeatExitPoint(player, seat) {
  const preferred = {
    up: [0, 1],
    down: [0, -1],
    left: [1, 0],
    right: [-1, 0]
  }[seat.direction] || [0, 1];
  const directions = [
    preferred,
    [0, 1], [1, 1], [1, 0], [1, -1],
    [0, -1], [-1, -1], [-1, 0], [-1, 1]
  ].filter((direction, index, list) =>
    list.findIndex((entry) => entry[0] === direction[0] && entry[1] === direction[1]) === index
  );

  for (let distance = 26; distance <= 106; distance += 8) {
    for (const [directionX, directionY] of directions) {
      const directionLength = Math.hypot(directionX, directionY);
      const x = seat.x + directionX / directionLength * distance;
      const y = seat.y + directionY / directionLength * distance;
      if (MAP_LAYOUT.isBlocked(x, y)) continue;
      const destinationRoom = roomFor({ x, y });
      if (destinationRoom && destinationRoom.id !== roomFor(player)?.id &&
          roomLocks.has(destinationRoom.id)) continue;
      const occupied = Array.from(players.values()).some((other) =>
        other.id !== player.id &&
        Math.hypot(other.x - x, other.y - y) < MAP_LAYOUT.PLAYER_RADIUS * 2 + 2
      );
      if (!occupied) return { x, y };
    }
  }
  return null;
}

function releaseSeat(player) {
  const seatId = player.seatId;
  if (player.seatId && seatReservations.get(player.seatId) === player.id) {
    seatReservations.delete(player.seatId);
  }
  player.seatId = null;
  player.sitting = false;
  player.sitStartedAt = null;
  return seatId;
}

async function standPlayer(player) {
  if (!player.sitting || !player.seatId) return true;
  const seat = MAP_LAYOUT.SEATS.find((entry) => entry.id === player.seatId);
  if (!seat) return false;
  const exitPoint = findSeatExitPoint(player, seat);
  if (!exitPoint) return false;
  const releasedSeatId = releaseSeat(player);
  await releaseSharedSeat(releasedSeatId, player.id);
  player.x = exitPoint.x;
  player.y = exitPoint.y;
  player.moving = false;
  return true;
}

function isInOffice(player) {
  return player.x >= OFFICE.x &&
    player.x <= OFFICE.x + OFFICE.width &&
    player.y >= OFFICE.y &&
    player.y <= OFFICE.y + OFFICE.height;
}

function pairKey(firstId, secondId) {
  return [firstId, secondId].sort().join('|');
}

async function createPairResources(pair) {
  try {
    const pairPlayers = pair.userIds.map((playerId) => players.get(playerId)).filter(Boolean);
    const owner = pairPlayers.find((player) => player.session) || pairPlayers[0];
    if (!owner) return;
    const sessionData = owner.session || await new Promise((resolve, reject) => {
      if (!owner.sessionID || !redisSessionStore) {
        reject(new Error('Toplantı sahibi oturumu bulunamadı.'));
        return;
      }
      redisSessionStore.get(owner.sessionID, (error, value) => {
        if (error) reject(error);
        else if (!value) reject(new Error('Toplantı sahibi oturumu süresi dolmuş.'));
        else resolve(value);
      });
    });
    const meet = google.meet({ version: 'v2', auth: googleClientFor(sessionData) });
    const response = await meet.spaces.create({ requestBody: {} });
    if (!response.data.meetingUri) throw new Error('Meet API toplantı bağlantısı döndürmedi.');
    if (pairSessions.get(pair.key) !== pair) return;
    pair.meetUrl = response.data.meetingUri;
  } catch (error) {
    if (pairSessions.get(pair.key) !== pair) return;
    pair.error = errorMessage(error);
    console.error(`Yakınlık Meet bağlantısı (${pair.key}) başarısız:`, pair.error);
  }
  if (pairSessions.get(pair.key) !== pair) return;
  await persistPair(pair);
  notifyContexts();
}

function getContextFor(player) {
  const chatSpaceName = ROOM_CHAT_SPACE || null;
  const room = roomFor(player);
  if (room) {
    return {
      key: `room-${room.id}`,
      mode: 'room',
      roomId: room.id,
      label: room.name,
      meetUrl: room.meetUrl || null,
      meetUrlKey: `ROOM${room.id}_MEET_URL`,
      locked: roomLocks.has(room.id),
      chatSpaceName
    };
  }

  let closestPair = null;
  for (const pair of pairSessions.values()) {
    if (!pair.userIds.includes(player.id)) continue;
    const peer = players.get(pair.userIds.find((id) => id !== player.id));
    if (!peer) continue;
    const distance = Math.hypot(player.x - peer.x, player.y - peer.y);
    if (!closestPair || distance < closestPair.distance) {
      closestPair = { pair, peer, distance };
    }
  }
  if (!closestPair) {
    return { key: 'none', mode: 'none', label: 'Aktif görüşme yok', chatSpaceName };
  }

  return {
    key: closestPair.pair.key,
    mode: 'pair',
    pairKey: closestPair.pair.key,
    peerId: closestPair.peer.id,
    label: `${closestPair.peer.name} ile yakın görüşme`,
    peerName: closestPair.peer.name,
    meetUrl: closestPair.pair.meetUrl,
    chatSpaceName,
    error: closestPair.pair.error || null
  };
}

function notifyContexts() {
  for (const player of players.values()) {
    if (localSocketIds.has(player.id)) {
      io.local.to(player.id).emit('context', getContextFor(player));
    }
  }
}

function broadcastRoomLocks() {
  io.local.emit('roomLocks', getRoomLockState());
}

function broadcastPlayers() {
  io.local.emit('players', Array.from(players.values(), (current) => ({
    id: current.id,
    name: current.name,
    x: current.x,
    y: current.y,
    character: current.character,
    direction: current.direction,
    moving: current.moving,
    online: true,
    seatId: current.seatId || null,
    sitting: current.sitting === true,
    sitStartedAt: current.sitStartedAt,
    drinkingCoffee: current.drinkingCoffee === true,
    coffeeStartedAt: current.coffeeStartedAt,
    inMeetingRoom: isInRoom(current),
    roomId: roomFor(current)?.id || null
  })));
}

async function updatePairs() {
  const nextPairs = new Map();
  const available = Array.from(players.values()).filter((player) =>
    !isInRoom(player) && isInOffice(player)
  );

  for (let firstIndex = 0; firstIndex < available.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < available.length; secondIndex += 1) {
      const first = available[firstIndex];
      const second = available[secondIndex];
      if (Math.hypot(first.x - second.x, first.y - second.y) > PROXIMITY) continue;
      const key = pairKey(first.id, second.id);
      nextPairs.set(key, [first.id, second.id]);
    }
  }

  for (const [key, pair] of pairSessions) {
    if (nextPairs.has(key)) continue;
    if (pair.pendingInvite) {
      clearTimeout(pair.pendingInvite.timeout);
      io.to(pair.pendingInvite.fromId).emit('meetingInviteCancelled', { pairKey: key });
      io.to(pair.pendingInvite.toId).emit('meetingInviteCancelled', {
        inviteId: pair.pendingInvite.id,
        pairKey: key
      });
    }
    pairSessions.delete(key);
    await removePairState(key);
  }
  for (const [key, userIds] of nextPairs) {
    if (pairSessions.has(key)) continue;
    if (redisClient) {
      const acquired = await redisClient.set(`gather:office:pair-create:${key}`, instanceId, {
        NX: true,
        EX: 60
      });
      if (acquired !== 'OK') {
        const sharedPair = await redisClient.hGet(sharedStateKeys.pairs, key);
        if (sharedPair) pairSessions.set(key, hydratePair(JSON.parse(sharedPair)));
        continue;
      }
    }
    const pair = { key, userIds, meetUrl: null, error: null, messages: [], pendingInvite: null };
    pairSessions.set(key, pair);
    await persistPair(pair);
    createPairResources(pair).catch((error) => {
      pair.error = errorMessage(error);
      console.error(`Yakınlık entegrasyonu (${key}) başarısız:`, pair.error);
      persistPair(pair).catch((saveError) =>
        console.error(`Yakınlık durumu kaydedilemedi (${key}):`, saveError.message)
      );
      notifyContexts();
    });
  }
  notifyContexts();
}

function activePairFor(player, pairKeyValue) {
  const pair = pairSessions.get(String(pairKeyValue || ''));
  if (!pair || !pair.userIds.includes(player.id)) return null;
  const peer = players.get(pair.userIds.find((userId) => userId !== player.id));
  if (!peer || isInRoom(player) || isInRoom(peer) ||
      !isInOffice(player) || !isInOffice(peer) ||
      Math.hypot(player.x - peer.x, player.y - peer.y) > PROXIMITY) return null;
  return pair;
}

function pendingMeetingPairFor(userId) {
  return Array.from(pairSessions.values()).find((pair) =>
    pair.pendingInvite &&
    (pair.pendingInvite.fromId === userId || pair.pendingInvite.toId === userId)
  ) || null;
}

function activeChatSpaces(email) {
  return ROOM_CHAT_SPACE ? new Set([ROOM_CHAT_SPACE]) : new Set();
}

function registerSocketHandler(socket, event, handler) {
  socket.on(event, (payload) => {
    Promise.resolve(handler(payload)).catch((error) => {
      console.error(`Socket.IO ${event} işlemi başarısız:`, error.message);
      if (event !== 'disconnect' && socket.connected) {
        socket.emit('serverError', 'İşlem tamamlanamadı. Lütfen yeniden deneyin.');
      }
    });
  });
}

app.post('/api/login', loginLimiter, (req, res, next) => {
  const supplied = Buffer.from(String(req.body?.password || ''));
  const expected = Buffer.from(OFFICE_PASSWORD);
  const matches = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!matches) return res.status(401).json({ error: 'Ofis şifresi hatalı.' });

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.passwordVerified = true;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.json({ ok: true });
    });
  });
});

app.get('/auth/google', (req, res, next) => {
  if (!req.session.passwordVerified) {
    return res.status(401).send('Önce ofis şifresini doğrulayın.');
  }
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  req.session.save((error) => {
    if (error) return next(error);
    const authUrl = createOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state
    });
    res.redirect(authUrl);
  });
});

app.get('/auth/google/callback', async (req, res, next) => {
  try {
    if (!req.session.passwordVerified ||
        !req.session.oauthState ||
        req.query.state !== req.session.oauthState ||
        !req.query.code) {
      return res.status(400).send('OAuth doğrulaması başarısız oldu. Giriş akışını yeniden başlatın.');
    }

    const client = createOAuthClient();
    const { tokens } = await client.getToken(String(req.query.code));
    client.setCredentials(tokens);
    const userInfo = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    const user = userInfo.data;
    if (!user.email || !user.id) throw new Error('Google hesabından e-posta alınamadı.');

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.authenticated = true;
      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name || user.email
      };
      req.session.googleTokens = tokens;
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.redirect('/');
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', async (req, res, next) => {
  if (!req.session.authenticated) return res.json({ authenticated: false });
  try {
    const character = await getCharacterProfile(req.session.user.id);
    res.json({ authenticated: true, user: req.session.user, character });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', requireAuthenticated, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('gather.sid', { httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true });
  });
});

app.put('/api/profile', requireAuthenticated, async (req, res, next) => {
  const character = validateCharacter(req.body?.character);
  if (!character) {
    return res.status(400).json({ error: 'Karakter renkleri veya görünüm seçenekleri geçersiz.' });
  }

  try {
    const userId = req.session.user.id;
    characterProfiles[userId] = character;
    profileVersion += 1;
    await persistCharacterProfiles();
    for (const player of players.values()) {
      if (player.userId === userId) player.character = { ...character };
    }
    await publishSharedState('profile-upsert', { userId, character });
    broadcastPlayers();
    res.json({ character });
  } catch (error) {
    next(error);
  }
});

app.get('/api/chat/messages', requireAuthenticated, async (req, res, next) => {
  try {
    const space = String(req.query.space || '');
    if (!ROOM_CHAT_SPACE) {
      return res.status(503).json({ error: 'Sürekli sohbet için .env içindeki ROOM_CHAT_SPACE değerini ayarlayın.' });
    }
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(space) ||
        !activeChatSpaces(req.session.user.email).has(space)) {
      return res.status(403).json({ error: 'Bu Chat alanı şu anki görüşme bağlamında kullanılamıyor.' });
    }
    const chat = getChatApi(req.session);
    const response = await chat.spaces.messages.list({
      parent: space,
      pageSize: 30,
      orderBy: 'createTime desc'
    });
    res.json({ messages: response.data.messages || [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat/messages', requireAuthenticated, async (req, res, next) => {
  try {
    const space = String(req.body?.space || '');
    const text = String(req.body?.text || '').trim();
    if (!ROOM_CHAT_SPACE) {
      return res.status(503).json({ error: 'Sürekli sohbet için .env içindeki ROOM_CHAT_SPACE değerini ayarlayın.' });
    }
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(space) ||
        !activeChatSpaces(req.session.user.email).has(space)) {
      return res.status(403).json({ error: 'Bu Chat alanı şu anki görüşme bağlamında kullanılamıyor.' });
    }
    if (!text || text.length > 4000) {
      return res.status(400).json({ error: 'Mesaj 1-4000 karakter olmalıdır.' });
    }
    const chat = getChatApi(req.session);
    const response = await chat.spaces.messages.create({
      parent: space,
      requestBody: { text }
    });
    res.json({ message: response.data });
  } catch (error) {
    next(error);
  }
});

io.engine.use((req, res, next) => {
  redisReady.then(() => sessionMiddleware(req, res, next)).catch(next);
});
io.use(async (socket, next) => {
  const sessionData = socket.request.session;
  if (!sessionData?.authenticated || !sessionData.googleTokens || !sessionData.user) {
    return next(new Error('Önce Google ile giriş yapın.'));
  }
  try {
    socket.request.character = await getCharacterProfile(sessionData.user.id);
    next();
  } catch (error) {
    next(error);
  }
});

io.on('connection', async (socket) => {
  try {
    await redisReady;
    await refreshSharedState();
  } catch (error) {
    console.error('Paylaşılan ofis durumu yüklenemedi:', error.message);
    socket.disconnect(true);
    return;
  }
  const sessionData = socket.request.session;
  const spawn = findSpawnPoint();
  const player = {
    id: socket.id,
    userId: sessionData.user.id,
    email: sessionData.user.email,
    name: sessionData.user.name,
    character: socket.request.character,
    session: sessionData,
    sessionID: socket.request.sessionID,
    x: spawn.x,
    y: spawn.y,
    direction: 'down',
    moving: false,
    seatId: null,
    sitting: false,
    sitStartedAt: null,
    drinkingCoffee: false,
    coffeeStartedAt: null,
    coffeeTimer: null,
    lastMoveAt: 0,
    lastSharedStateAt: 0,
    lastSeenAt: Date.now(),
    lastRoomLockAt: 0,
    lastLockedNoticeAt: 0,
    lastPairMessageAt: 0
  };
  players.set(socket.id, player);
  localSocketIds.add(socket.id);
  try {
    await persistPlayerState(player, true);
  } catch (error) {
    console.error('Oyuncu başlangıç durumu kaydedilemedi:', error.message);
    players.delete(socket.id);
    localSocketIds.delete(socket.id);
    socket.disconnect(true);
    return;
  }
  player.heartbeatTimer = setInterval(() => {
    persistPlayerState(player, true).catch((error) =>
      console.error(`Oyuncu durumu kaydedilemedi (${player.id}):`, error.message)
    );
  }, 30000);
  player.heartbeatTimer.unref?.();
  socket.emit('roomLocks', getRoomLockState());

  registerSocketHandler(socket, 'move', async (position) => {
    const now = Date.now();
    if (now - player.lastMoveAt < 40) return;
    player.lastMoveAt = now;
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (player.drinkingCoffee) return;
    if (player.sitting) {
      if (position.moving !== true) return;
      const previousRoomId = roomFor(player)?.id;
      if (!await standPlayer(player)) {
        socket.emit('sitError', 'Sandalyeden kalkmak için yakınlarda boş alan yok.');
        return;
      }
      if (previousRoomId && previousRoomId !== roomFor(player)?.id &&
          unlockRoomIfEmpty(previousRoomId)) {
        await setSharedRoomLock(previousRoomId, false);
        broadcastRoomLocks();
      }
      await persistPlayerState(player, true);
      broadcastPlayers();
      await updatePairs();
      return;
    }

    const targetX = Math.max(MAP_LAYOUT.PLAYER_RADIUS, Math.min(WORLD.width - MAP_LAYOUT.PLAYER_RADIUS, x));
    const targetY = Math.max(MAP_LAYOUT.PLAYER_RADIUS, Math.min(WORLD.height - MAP_LAYOUT.PLAYER_RADIUS, y));
    let deltaX = targetX - player.x;
    let deltaY = targetY - player.y;
    const requestedDistance = Math.hypot(deltaX, deltaY);
    if (requestedDistance > 40) {
      deltaX = deltaX / requestedDistance * 40;
      deltaY = deltaY / requestedDistance * 40;
    }

    const previousRoomId = roomFor(player)?.id;
    const originRoom = roomFor(player);
    const previousX = player.x;
    const previousY = player.y;
    let lockedRoomAttempt = null;
    const nextPosition = MAP_LAYOUT.slide(
      player.x,
      player.y,
      deltaX,
      deltaY,
      (nextX, nextY) => !canPlayerOccupy(player, originRoom, nextX, nextY, (room) => {
        lockedRoomAttempt = room;
      })
    );
    player.x = nextPosition.x;
    player.y = nextPosition.y;
    if (['up', 'down', 'left', 'right'].includes(position.direction)) {
      player.direction = position.direction;
    }
    player.moving = position.moving === true &&
      Math.hypot(player.x - previousX, player.y - previousY) > 0.1;
    if (lockedRoomAttempt && now - player.lastLockedNoticeAt >= 1200) {
      socket.emit('roomEntryBlocked', `${lockedRoomAttempt.name} kilitli.`);
      player.lastLockedNoticeAt = now;
    }

    const currentRoomId = roomFor(player)?.id;
    if (previousRoomId && previousRoomId !== currentRoomId && unlockRoomIfEmpty(previousRoomId)) {
      await setSharedRoomLock(previousRoomId, false);
      broadcastRoomLocks();
    }
    await persistPlayerState(player);
    broadcastPlayers();
    await updatePairs();
  });

  registerSocketHandler(socket, 'sitDown', async (payload) => {
    const seat = MAP_LAYOUT.SEATS.find((entry) => entry.id === String(payload?.seatId || ''));
    if (!seat) {
      socket.emit('sitError', 'Seçilen sandalye bulunamadı.');
      return;
    }
    if (player.drinkingCoffee) {
      socket.emit('sitError', 'Kahve içerken oturamazsınız.');
      return;
    }
    if (player.sitting) {
      socket.emit('sitError', 'Önce bulunduğunuz sandalyeden kalkın.');
      return;
    }
    if (Math.hypot(player.x - seat.x, player.y - seat.y) > 58 ||
        (roomFor(player)?.id || null) !== (roomFor(seat)?.id || null)) {
      socket.emit('sitError', 'Oturmak için sandalyeye yaklaşın.');
      return;
    }
    if (!await reserveSharedSeat(seat.id, player.id)) {
      socket.emit('sitError', 'Bu sandalye dolu.');
      return;
    }

    seatReservations.set(seat.id, player.id);
    player.seatId = seat.id;
    player.sitting = true;
    player.sitStartedAt = Date.now();
    player.x = seat.x;
    player.y = seat.y;
    player.direction = seat.direction;
    player.moving = false;
    await persistPlayerState(player, true);
    broadcastPlayers();
    await updatePairs();
  });

  registerSocketHandler(socket, 'standUp', async () => {
    if (!player.sitting) return;
    const previousRoomId = roomFor(player)?.id;
    if (!await standPlayer(player)) {
      socket.emit('sitError', 'Sandalyeden kalkmak için yakınlarda boş alan yok.');
      return;
    }
    if (previousRoomId && previousRoomId !== roomFor(player)?.id &&
        unlockRoomIfEmpty(previousRoomId)) {
      await setSharedRoomLock(previousRoomId, false);
      broadcastRoomLocks();
    }
    await persistPlayerState(player, true);
    broadcastPlayers();
    await updatePairs();
  });

  registerSocketHandler(socket, 'drinkCoffee', async () => {
    if (player.drinkingCoffee) return;
    if (player.sitting) {
      socket.emit('coffeeError', 'Kahve içmek için önce sandalyeden kalkın.');
      return;
    }
    if (!isInOffice(player) || isInRoom(player) ||
        Math.hypot(player.x - COFFEE_STATION.x, player.y - COFFEE_STATION.y) >
          COFFEE_STATION.interactionRadius) {
      socket.emit('coffeeError', 'Kahve makinesine yaklaşın.');
      return;
    }

    const deltaX = COFFEE_STATION.x - player.x;
    const deltaY = COFFEE_STATION.y - player.y;
    player.direction = Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX > 0 ? 'right' : 'left')
      : (deltaY > 0 ? 'down' : 'up');
    player.moving = false;
    player.drinkingCoffee = true;
    player.coffeeStartedAt = Date.now();
    const coffeeStartedAt = player.coffeeStartedAt;
    player.coffeeTimer = setTimeout(() => {
      if (!players.has(player.id) || player.coffeeStartedAt !== coffeeStartedAt) return;
      Promise.resolve().then(async () => {
        player.drinkingCoffee = false;
        player.coffeeStartedAt = null;
        player.coffeeTimer = null;
        await persistPlayerState(player, true);
        broadcastPlayers();
      }).catch((error) => {
        console.error(`Kahve durumu kaydedilemedi (${player.id}):`, error.message);
      });
    }, COFFEE_DRINK_DURATION_MS);
    player.coffeeTimer.unref?.();
    await persistPlayerState(player, true);
    broadcastPlayers();
  });

  registerSocketHandler(socket, 'toggleRoomLock', async (requestedRoomId) => {
    await refreshSharedState();
    const roomId = Number(requestedRoomId);
    if (!MEETING_ROOMS.some((room) => room.id === roomId) || roomFor(player)?.id !== roomId) {
      socket.emit('roomLockError', 'Oda kilidini yalnızca odanın içindeyken değiştirebilirsiniz.');
      return;
    }
    const now = Date.now();
    if (now - player.lastRoomLockAt < 300) return;
    player.lastRoomLockAt = now;
    await toggleSharedRoomLock(roomId);
    broadcastRoomLocks();
    notifyContexts();
  });

  registerSocketHandler(socket, 'requestMeeting', async (payload) => {
    await refreshSharedState();
    const pair = activePairFor(player, payload?.pairKey);
    if (!pair) {
      socket.emit('meetingRequestError', 'Toplantı isteği için diğer kullanıcıya yakın olmalısınız.');
      return;
    }
    if (!pair.meetUrl) {
      socket.emit('meetingRequestError', 'Meet bağlantısı henüz hazır değil.');
      return;
    }
    const peerId = pair.userIds.find((userId) => userId !== player.id);
    const peer = players.get(peerId);
    if (pendingMeetingPairFor(player.id) || pendingMeetingPairFor(peerId)) {
      socket.emit('meetingRequestError', 'Bu kullanıcılardan biri için bekleyen bir toplantı isteği var.');
      return;
    }

    const invite = {
      id: crypto.randomUUID(),
      pairKey: pair.key,
      fromId: player.id,
      toId: peerId,
      meetUrl: pair.meetUrl,
      timeout: null
    };
    pair.pendingInvite = invite;
    invite.timeout = setTimeout(() => {
      if (pairSessions.get(pair.key) !== pair || pair.pendingInvite?.id !== invite.id) return;
      pair.pendingInvite = null;
      persistPair(pair).catch((error) =>
        console.error(`Toplantı isteği durumu kaydedilemedi (${pair.key}):`, error.message)
      );
      io.to(invite.fromId).emit('meetingInviteExpired', { pairKey: pair.key });
      io.to(invite.toId).emit('meetingInviteCancelled', { inviteId: invite.id, pairKey: pair.key });
    }, 45000);
    invite.timeout.unref?.();
    await persistPair(pair);

    socket.emit('meetingInviteSent', { pairKey: pair.key, peerName: peer.name });
    io.to(peerId).emit('meetingRequest', {
      inviteId: invite.id,
      pairKey: pair.key,
      fromName: player.name,
      meetUrl: pair.meetUrl
    });
  });

  registerSocketHandler(socket, 'respondMeetingRequest', async (payload) => {
    await refreshSharedState();
    const pair = activePairFor(player, payload?.pairKey);
    const invite = pair?.pendingInvite;
    if (!invite || invite.id !== payload?.inviteId || invite.toId !== player.id) {
      socket.emit('meetingRequestError', 'Bu toplantı isteği artık geçerli değil.');
      return;
    }
    clearTimeout(invite.timeout);
    pair.pendingInvite = null;
    await persistPair(pair);
    const accepted = payload.accepted === true;
    const inviter = players.get(invite.fromId);
    io.to(invite.fromId).emit('meetingInviteResult', {
      pairKey: pair.key,
      accepted,
      peerName: player.name,
      meetUrl: pair.meetUrl
    });
    if (accepted) {
      socket.emit('meetingInviteResult', {
        pairKey: pair.key,
        accepted: true,
        recipient: true,
        peerName: inviter?.name || 'Kullanıcı',
        meetUrl: pair.meetUrl
      });
    }
  });

  registerSocketHandler(socket, 'openPairChat', async (payload) => {
    await refreshSharedState();
    const pair = activePairFor(player, payload?.pairKey);
    if (!pair) {
      socket.emit('pairChatError', 'Özel sohbeti başlatmak için diğer kullanıcıya yakın olmalısınız.');
      return;
    }
    const peerId = pair.userIds.find((userId) => userId !== player.id);
    io.to(peerId).emit('peerOpenedPairChat', {
      pairKey: pair.key,
      peerName: player.name
    });
  });

  registerSocketHandler(socket, 'requestPairChatHistory', async (payload) => {
    await refreshSharedState();
    const pair = activePairFor(player, payload?.pairKey);
    if (!pair) {
      socket.emit('pairChatError', 'Özel sohbet için diğer kullanıcıya yakın olmalısınız.');
      return;
    }
    socket.emit('pairChatHistory', { pairKey: pair.key, messages: pair.messages });
  });

  registerSocketHandler(socket, 'pairChatMessage', async (payload) => {
    await refreshSharedState();
    const pair = activePairFor(player, payload?.pairKey);
    if (!pair) {
      socket.emit('pairChatError', 'Özel sohbet yalnızca yanınızdaki kullanıcıyla kullanılabilir.');
      return;
    }
    const text = String(payload?.text || '').trim();
    if (!text || text.length > 1000) {
      socket.emit('pairChatError', 'Özel mesaj 1-1000 karakter olmalıdır.');
      return;
    }
    const now = Date.now();
    if (now - player.lastPairMessageAt < 250) return;
    player.lastPairMessageAt = now;
    const message = {
      id: crypto.randomUUID(),
      senderId: player.id,
      senderName: player.name,
      text,
      createTime: new Date(now).toISOString()
    };
    pair.messages.push(message);
    if (pair.messages.length > 100) pair.messages.shift();
    await persistPair(pair);
    for (const userId of pair.userIds) {
      io.to(userId).emit('pairChatMessage', { pairKey: pair.key, message });
    }
  });

  registerSocketHandler(socket, 'disconnect', async () => {
    const roomId = roomFor(player)?.id;
    const releasedSeatId = releaseSeat(player);
    await releaseSharedSeat(releasedSeatId, player.id);
    clearTimeout(player.coffeeTimer);
    clearInterval(player.heartbeatTimer);
    players.delete(socket.id);
    localSocketIds.delete(socket.id);
    await removePlayerState(socket.id);
    if (unlockRoomIfEmpty(roomId)) {
      await setSharedRoomLock(roomId, false);
      broadcastRoomLocks();
    }
    try {
      await updatePairs();
      broadcastPlayers();
    } catch (error) {
      console.error('İlk oyuncu durumu yayınlanamadı:', error.message);
      socket.emit('serverError', 'Ofis durumu yüklenemedi. Yeniden bağlanın.');
    }
  });

  await updatePairs();
  broadcastPlayers();
});

app.use((error, req, res, next) => {
  console.error('İstek başarısız:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: errorMessage(error) });
});

if (redisClient) {
  redisReady = Promise.all([
    redisClient.connect(),
    redisPubClient.connect(),
    redisSubClient.connect()
  ]).then(async () => {
    io.adapter(createAdapter(redisPubClient, redisSubClient));
    await redisSubClient.subscribe(sharedStateChannel, (message) => {
      handleSharedStateMessage(message).catch((error) =>
        console.error('Paylaşılan durum güncellenemedi:', error.message)
      );
    });
    await refreshSharedState();
  });
}

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Gather Town prototipi http://localhost:${PORT} adresinde çalışıyor.`);
  });
}

app.server = server;
module.exports = app;
