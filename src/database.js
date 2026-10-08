const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(process.cwd(), 'data');
const file = path.join(dataDir, 'database.json');

const DEFAULT = { guilds: {}, blacklist: {}, pending: {}, history: [] };

function ensure() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULT, null, 2));
}

function load() {
  ensure();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULT, ...data };
  } catch {
    return structuredClone(DEFAULT);
  }
}

let db = load();
function save() {
  ensure();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

function getGuild(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = {};
  return db.guilds[guildId];
}

function setGuild(guildId, patch) {
  db.guilds[guildId] = { ...getGuild(guildId), ...patch };
  save();
  return db.guilds[guildId];
}

function setPending(userId, record) { db.pending[userId] = record; save(); }
function getPending(userId) { return db.pending[userId]; }
function deletePending(userId) { delete db.pending[userId]; save(); }

function blacklist(guildId, userId, record) {
  if (!db.blacklist[guildId]) db.blacklist[guildId] = {};
  db.blacklist[guildId][userId] = record;
  save();
}
function unblacklist(guildId, userId) {
  if (db.blacklist[guildId]) delete db.blacklist[guildId][userId];
  save();
}
function getBlacklist(guildId, userId) { return db.blacklist[guildId]?.[userId]; }

function addHistory(record) {
  db.history.push(record);
  if (db.history.length > 5000) db.history = db.history.slice(-5000);
  save();
}

module.exports = { getGuild, setGuild, setPending, getPending, deletePending, blacklist, unblacklist, getBlacklist, addHistory };
