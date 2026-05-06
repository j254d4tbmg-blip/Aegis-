require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://aegis-production-27c2.up.railway.app";
const VERSION = "AEGIS-1.0.1-STABLE";

const status = {
  website: "starting",
  database: "offline",
  bot: "offline",
  ai: "not_attached",
  fivem: "waiting",
  cad: "online",
  version: VERSION,
  startedAt: new Date().toISOString(),
  lastError: null,
  lastFiveMHeartbeat: null
};

let db = null;
let client = null;

function error(area, err) {
  const msg = err?.message || String(err);
  status.lastError = `${area}: ${msg}`;
  status[area] = "error";
  console.error(`[${area}]`, msg);
}

process.on("uncaughtException", err => error("system", err));
process.on("unhandledRejection", err => error("system", err));

function code() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function key() {
  return crypto.randomBytes(24).toString("hex");
}

/* WEBSITE ALWAYS STARTS FIRST */

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>AEGIS Command Operations System</title>
    <style>
      body{background:#050814;color:white;font-family:Arial;text-align:center;padding:80px}
      h1{color:#75bfff}
      .card{background:#0d1728;border:1px solid #274569;border-radius:14px;padding:25px;max-width:850px;margin:auto}
      a{color:#75bfff}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>AEGIS Command Operations System</h1>
      <p>Official GTA RP Government Infrastructure</p>
      <p>Status: Online</p>
      <p><a href="/health">System Health</a></p>
      <p><a href="/cad">AEGIS CAD Operations Network</a></p>
    </div>
  </body>
  </html>
  `);
});

app.get("/health", (req, res) => {
  res.json(status);
});

app.get("/cad", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>AEGIS CAD Operations Network</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{margin:0;background:#050814;color:white;font-family:Arial}
      header{background:#07111f;border-bottom:1px solid #274569;padding:24px}
      h1{color:#75bfff;margin:0}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;padding:18px}
      .card{background:#0d1728;border:1px solid #274569;border-radius:12px;padding:18px}
    </style>
  </head>
  <body>
    <header>
      <h1>AEGIS CAD Operations Network</h1>
      <p>Standalone dispatch and government operations environment.</p>
    </header>
    <div class="grid">
      <div class="card"><h2>Dispatch</h2><p>No active calls detected.</p></div>
      <div class="card"><h2>FiveM Bridge</h2><p>${status.fivem === "online" ? "Connected" : "Waiting for FiveM heartbeat."}</p></div>
      <div class="card"><h2>Active Units</h2><p>No active units currently on duty.</p></div>
      <div class="card"><h2>AI Operations</h2><p>${status.ai}</p></div>
      <div class="card"><h2>Database</h2><p>${status.database}</p></div>
      <div class="card"><h2>Bot</h2><p>${status.bot}</p></div>
    </div>
  </body>
  </html>
  `);
});

/* FIVEM ENDPOINTS */

app.post("/api/fivem/heartbeat", async (req, res) => {
  status.fivem = "online";
  status.lastFiveMHeartbeat = new Date().toISOString();
  res.json({ success: true, message: "AEGIS FiveM heartbeat received" });
});

app.post("/api/fivem/event", async (req, res) => {
  status.fivem = "online";
  if (db) {
    try {
      await db.query(
        "INSERT INTO system_logs(type, message) VALUES($1, $2)",
        ["FIVEM_EVENT", JSON.stringify(req.body)]
      );
    } catch (err) {
      error("database", err);
    }
  }
  res.json({ success: true });
});

/* START WEBSITE FIRST */

app.listen(PORT, () => {
  status.website = "online";
  console.log(`AEGIS website running on port ${PORT}`);
});

/* DATABASE SAFE START */

async function startDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      status.database = "missing_DATABASE_URL";
      return;
    }

    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    await db.query("SELECT NOW()");

    await db.query(`
      CREATE TABLE IF NOT EXISTS system_logs(
        id SERIAL PRIMARY KEY,
        type TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS access_codes(
        code TEXT PRIMARY KEY,
        user_id TEXT,
        guild_id TEXT,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS servers(
        guild_id TEXT PRIMARY KEY,
        name TEXT,
        fivem_api_key TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    status.database = "online";
    console.log("Database online");
  } catch (err) {
    error("database", err);
  }
}

/* DISCORD BOT SAFE START */

async function registerCommands() {
  try {
    if (!process.env.TOKEN || !process.env.CLIENT_ID) {
      console.log("Skipping slash commands: TOKEN or CLIENT_ID missing");
      return;
    }

    const commands = [
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("View AEGIS system status."),

      new SlashCommandBuilder()
        .setName("portal")
        .setDescription("Get your secure AEGIS website access code."),

      new SlashCommandBuilder()
        .setName("cad")
        .setDescription("Get the AEGIS CAD link."),

      new SlashCommandBuilder()
        .setName("setup-fivem")
        .setDescription("Generate a FiveM bridge API key.")
    ].map(c => c.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

    console.log("Slash commands registered");
  } catch (err) {
    error("commands", err);
  }
}

async function startBot() {
  try {
    if (!process.env.TOKEN) {
      status.bot = "missing_TOKEN";
      return;
    }

    client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });

    client.once("ready", async () => {
      status.bot = "online";
      console.log(`AEGIS bot online as ${client.user.tag}`);
      await registerCommands();

      try {
        if (process.env.OWNER_ID) {
          const owner = await client.users.fetch(process.env.OWNER_ID);
          await owner.send(`🟢 AEGIS online\n${BASE_URL}`);
        }
      } catch {}
    });

    client.on("interactionCreate", async interaction => {
      try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === "status") {
          return interaction.reply({
            content: "```json\n" + JSON.stringify(status, null, 2) + "\n```",
            ephemeral: true
          });
        }

        if (interaction.commandName === "cad") {
          return interaction.reply({
            content: `AEGIS CAD Operations Network:\n${BASE_URL}/cad`,
            ephemeral: true
          });
        }

        if (interaction.commandName === "portal") {
          const accessCode = code();

          if (db) {
            await db.query(
              "INSERT INTO access_codes(code, user_id, guild_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [accessCode, interaction.user.id, interaction.guildId || "unknown"]
            ).catch(err => error("database", err));
          }

          await interaction.user.send(
            `🚨 AEGIS COMMAND PORTAL\n\nAccess Code: ${accessCode}\nPortal: ${BASE_URL}\n\nDo not share this code.`
          ).catch(() => {});

          return interaction.reply({
            content: "📩 AEGIS access code sent to your DMs.",
            ephemeral: true
          });
        }

        if (interaction.commandName === "setup-fivem") {
          const apiKey = key();

          if (db) {
            await db.query(
              "INSERT INTO servers(guild_id, name, fivem_api_key) VALUES($1,$2,$3) ON CONFLICT(guild_id) DO UPDATE SET fivem_api_key=$3",
              [interaction.guildId || "unknown", interaction.guild?.name || "unknown", apiKey]
            ).catch(err => error("database", err));
          }

          return interaction.reply({
            content:
              `✅ AEGIS FiveM Bridge\n\n` +
              `API URL:\n${BASE_URL}/api/fivem/event\n\n` +
              `Heartbeat URL:\n${BASE_URL}/api/fivem/heartbeat\n\n` +
              `Guild ID:\n${interaction.guildId}\n\n` +
              `API Key:\n\`${apiKey}\``,
            ephemeral: true
          });
        }
      } catch (err) {
        error("interaction", err);
        if (!interaction.replied) {
          await interaction.reply({ content: `AEGIS error: ${err.message}`, ephemeral: true }).catch(() => {});
        }
      }
    });

    client.login(process.env.TOKEN).catch(err => {
      status.bot = "login_failed";
      error("bot", err);
    });
  } catch (err) {
    error("bot", err);
  }
}

/* AI SAFE ATTACH */

async function startAI() {
  try {
    if (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) {
      status.ai = "configured";
    } else {
      status.ai = "not_attached";
    }
  } catch (err) {
    error("ai", err);
  }
}

/* START BACKGROUND SYSTEMS */

(async () => {
  await startDatabase();
  await startAI();
  await startBot();

  setInterval(async () => {
    console.log("AEGIS diagnostics:", status);
    if (db) {
      await db.query(
        "INSERT INTO system_logs(type, message) VALUES($1,$2)",
        ["DIAGNOSTIC", JSON.stringify(status)]
      ).catch(err => error("database", err));
    }
  }, 10 * 60 * 1000);
})();