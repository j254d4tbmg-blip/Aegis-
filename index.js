require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require("discord.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERSION = "AEGIS-1.0.0";

const status = {
  website: "starting",
  database: "starting",
  bot: "starting",
  fivem: "waiting",
  ai: "not_configured",
  cad: "online",
  version: VERSION,
  startedAt: new Date().toISOString(),
  lastError: null,
  lastFiveMHeartbeat: null
};

let db;
let client;

function setError(system, err) {
  const message = err?.message || String(err);
  status[system] = "error";
  status.lastError = `${system}: ${message}`;
  console.error(`[${system}]`, message);
}

process.on("uncaughtException", err => setError("system", err));
process.on("unhandledRejection", err => setError("system", err));

function makeCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function makeKey() {
  return crypto.randomBytes(24).toString("hex");
}

function slugify(text) {
  return String(text || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function serverUrl(guild) {
  return `${process.env.BASE_URL}/s/${slugify(guild.name)}-${guild.id}`;
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");

  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await db.query("SELECT NOW()");

  await db.query(`
    CREATE TABLE IF NOT EXISTS servers (
      guild_id TEXT PRIMARY KEY,
      name TEXT,
      slug TEXT,
      fivem_api_key TEXT,
      fivem_enabled BOOLEAN DEFAULT false,
      tts_enabled BOOLEAN DEFAULT false,
      duty_sync BOOLEAN DEFAULT false,
      panic_sync BOOLEAN DEFAULT false,
      map_sync BOOLEAN DEFAULT false,
      scene_data BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS access_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      guild_id TEXT,
      username TEXT,
      role_name TEXT,
      character_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      type TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fivem_events (
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      event_type TEXT,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  status.database = "online";
}

async function logSystem(guildId, type, message) {
  try {
    if (!db) return;
    await db.query(
      "INSERT INTO system_logs (guild_id, type, message) VALUES ($1, $2, $3)",
      [guildId || null, type, message]
    );
  } catch (err) {
    setError("database", err);
  }
}

async function ensureServer(guild) {
  const slug = slugify(guild.name);
  const existing = await db.query("SELECT * FROM servers WHERE guild_id=$1", [guild.id]);

  if (existing.rows.length === 0) {
    await db.query(
      `INSERT INTO servers (guild_id, name, slug)
       VALUES ($1, $2, $3)`,
      [guild.id, guild.name, slug]
    );
  } else {
    await db.query(
      `UPDATE servers SET name=$1, slug=$2, updated_at=NOW() WHERE guild_id=$3`,
      [guild.name, slug, guild.id]
    );
  }
}

async function notifyOwner(title, body) {
  try {
    if (!process.env.OWNER_ID || !client) return;
    const owner = await client.users.fetch(process.env.OWNER_ID);
    await owner.send(`🚨 **AEGIS COMMAND SYSTEM**\n\n**${title}**\n\n${body}`);
  } catch {}
}

async function setupDiscordServer(guild) {
  const categories = [
    "🏛️ INFORMATION",
    "🚔 LAW ENFORCEMENT",
    "⚖️ COURT SYSTEM",
    "🚗 CIVILIAN SERVICES",
    "🔒 STAFF OPERATIONS",
    "🤖 AEGIS SYSTEM"
  ];

  for (const name of categories) {
    if (!guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory)) {
      await guild.channels.create({ name, type: ChannelType.GuildCategory }).catch(() => {});
    }
  }

  const neededChannels = [
    "rules",
    "announcements",
    "dispatch",
    "arrest-reports",
    "bolo",
    "warrants",
    "court-calendar",
    "court-filings",
    "dmv",
    "civilian-requests",
    "staff-chat",
    "ai-system-logs",
    "aegis-status",
    "review-corner"
  ];

  for (const name of neededChannels) {
    if (!guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText)) {
      await guild.channels.create({ name, type: ChannelType.GuildText }).catch(() => {});
    }
  }

  await ensureServer(guild);
  await logSystem(guild.id, "SETUP", "Discord server infrastructure checked/created.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("portal")
    .setDescription("Get your secure AEGIS website access code."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("View AEGIS system status."),

  new SlashCommandBuilder()
    .setName("setup-server")
    .setDescription("Auto-create AEGIS Discord channels and system structure.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .set