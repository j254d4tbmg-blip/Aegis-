require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/", async (req, res) => {
  res.send(`
    <h1>AEGIS Command Operations System</h1>
    <p>System Online.</p>
    <p>CAD, Discord, FiveM, AI, DMV, Court, and Government Operations loading.</p>
  `);
});

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT NOW()");
    res.json({
      website: "online",
      database: "online",
      bot: client.user ? client.user.tag : "starting"
    });
  } catch (err) {
    res.json({
      website: "online",
      database: "error",
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`AEGIS website running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`AEGIS bot online as ${client.user.tag}`);
});

client.login(process.env.TOKEN);