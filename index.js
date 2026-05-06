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
  ChannelType,
  EmbedBuilder
} = require("discord.js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://aegis-production-27c2.up.railway.app";
const VERSION = "AEGIS-1.0.3-STABLE";

let db = null;
let client = null;

const status = {
  website: "starting",
  database: "offline",
  bot: "offline",
  commands: "not_registered",
  ai: "not_attached",
  fivem: "waiting",
  cad: "online",
  maintenance: "standby",
  version: VERSION,
  startedAt: new Date().toISOString(),
  lastError: null,
  lastFiveMHeartbeat: null,
  lastFiveMEvent: null
};

function reportError(area, err) {
  const msg = err?.message || String(err);
  status.lastError = `${area}: ${msg}`;
  if (status[area] !== undefined) status[area] = "error";
  console.error(`[${area}]`, msg);
}

process.on("uncaughtException", err => reportError("system", err));
process.on("unhandledRejection", err => reportError("system", err));

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function serverUrl(guild) {
  return `${BASE_URL}/s/${slugify(guild.name)}-${guild.id}`;
}

async function logSystem(type, message, guildId = null) {
  console.log(`[${type}] ${message}`);
  if (!db) return;
  try {
    await db.query(
      "INSERT INTO system_logs(guild_id,type,message) VALUES($1,$2,$3)",
      [guildId, type, message]
    );
  } catch (err) {
    reportError("database", err);
  }
}

async function getSetting(key, fallback = "") {
  if (!db) return fallback;
  try {
    const result = await db.query("SELECT value FROM app_settings WHERE key=$1", [key]);
    return result.rows[0]?.value || fallback;
  } catch {
    return fallback;
  }
}

async function setSetting(key, value) {
  if (!db) return;
  await db.query(
    `INSERT INTO app_settings(key,value,updated_at)
     VALUES($1,$2,NOW())
     ON CONFLICT(key)
     DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, value]
  );
}

function protectedEnvView() {
  return {
    TOKEN: process.env.TOKEN ? "Protected" : "Missing",
    CLIENT_ID: process.env.CLIENT_ID ? "Protected" : "Missing",
    DATABASE_URL: process.env.DATABASE_URL ? "Protected" : "Missing",
    OWNER_ID: process.env.OWNER_ID ? "Protected" : "Missing",
    BASE_URL: BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "Protected" : "Not Set",
    AI_API_KEY: process.env.AI_API_KEY ? "Protected" : "Not Set",
    FIVEM_API_KEY: process.env.FIVEM_API_KEY ? "Protected" : "Not Set",
    SESSION_SECRET: process.env.SESSION_SECRET ? "Protected" : "Missing"
  };
}

async function initDatabase() {
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
      guild_id TEXT,
      type TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs(
      id SERIAL PRIMARY KEY,
      type TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings(
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS servers(
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

    CREATE TABLE IF NOT EXISTS access_codes(
      code TEXT PRIMARY KEY,
      user_id TEXT,
      guild_id TEXT,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users(
      user_id TEXT PRIMARY KEY,
      guild_id TEXT,
      username TEXT,
      role_name TEXT,
      character_name TEXT,
      profile_logo TEXT,
      profile_banner TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fivem_events(
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      event_type TEXT,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS businesses(
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      owner_id TEXT,
      name TEXT,
      type TEXT,
      status TEXT DEFAULT 'Pending Review',
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS applications(
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      user_id TEXT,
      department TEXT,
      status TEXT DEFAULT 'Pending Review',
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reports(
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      user_id TEXT,
      department TEXT,
      type TEXT,
      status TEXT DEFAULT 'Filed',
      narrative TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS court_cases(
      id TEXT PRIMARY KEY,
      guild_id TEXT,
      defendant_id TEXT,
      status TEXT DEFAULT 'Pending',
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await setSetting("website_title", "AEGIS Command Operations System");
  await setSetting("homepage_message", "Official GTA RP Government Infrastructure");
  await setSetting("cad_notice", "AEGIS does not display fake calls, fake units, or fake FiveM activity.");
  await setSetting("maintenance_mode", "false");

  status.database = "online";
}

async function ensureServer(guild) {
  if (!db || !guild) return;
  await db.query(
    `INSERT INTO servers(guild_id,name,slug,updated_at)
     VALUES($1,$2,$3,NOW())
     ON CONFLICT(guild_id)
     DO UPDATE SET name=$2, slug=$3, updated_at=NOW()`,
    [guild.id, guild.name, slugify(guild.name)]
  );
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
    "💼 BUSINESS REGISTRY",
    "📋 RECRUITMENT",
    "🔒 STAFF OPERATIONS",
    "🤖 AEGIS SYSTEM"
  ];

  for (const name of categories) {
    if (!guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory)) {
      await guild.channels.create({ name, type: ChannelType.GuildCategory }).catch(() => {});
    }
  }

  const channels = [
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
    "business-registry",
    "business-applications",
    "recruitment",
    "applications",
    "staff-chat",
    "ai-system-logs",
    "maintenance-logs",
    "aegis-status",
    "review-corner"
  ];

  for (const name of channels) {
    if (!guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildText)) {
      await guild.channels.create({ name, type: ChannelType.GuildText }).catch(() => {});
    }
  }

  await ensureServer(guild);
  await logSystem("SETUP", "Discord server infrastructure checked/created.", guild.id);
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{
  --bg:#050814;
  --panel:#0d1728;
  --panel2:#07111f;
  --line:#274569;
  --blue:#75bfff;
  --text:#e8f1ff;
  --muted:#a9bcd3;
  --green:#7CFFB2;
  --yellow:#FFD166;
  --red:#ff5b5b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Arial, sans-serif}
a{color:var(--blue);text-decoration:none}
button{background:#0a4fa3;color:white;border:1px solid #2f80ed;padding:10px 14px;border-radius:8px;font-weight:bold}
input,textarea,select{width:100%;background:#07111f;color:white;border:1px solid #274569;border-radius:8px;padding:11px;margin:7px 0}
.watermark{position:fixed;top:35%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:60px;color:rgba(255,255,255,.035);font-weight:bold;letter-spacing:5px;pointer-events:none;z-index:0}
.header{position:relative;z-index:1;background:var(--panel2);border-bottom:1px solid var(--line);padding:24px;display:flex;justify-content:space-between;gap:15px;align-items:center}
.header h1{color:var(--blue);margin:0;letter-spacing:2px}
.seal{border:2px solid var(--blue);border-radius:50%;width:80px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--blue);font-weight:bold}
.hero{position:relative;z-index:1;text-align:center;padding:90px 20px;background:radial-gradient(circle at top,#123a73,transparent 38%)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 0 18px rgba(0,80,180,.12)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding:18px}
.sidebar{width:260px;position:fixed;left:0;top:0;height:100vh;background:var(--panel2);border-right:1px solid var(--line);padding:18px;overflow:auto}
.sidebar h2{color:var(--blue)}
.sidebar a{display:block;background:#111d33;border:1px solid var(--line);padding:11px;border-radius:8px;margin:8px 0}
.main{margin-left:280px;padding:22px}
.terminal{background:#02050a;border:1px solid #1c6dd0;border-radius:12px;overflow:hidden}
.terminal-title{background:#0a1b33;color:var(--blue);padding:12px;font-weight:bold;letter-spacing:2px}
.terminal-body{font-family:monospace;color:#40ff9c;padding:16px;min-height:220px}
.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}
@media(max-width:750px){
  .header{display:block;text-align:center}
  .seal{margin:15px auto}
  .sidebar{position:relative;width:100%;height:auto}
  .main{margin-left:0;padding:14px}
  .watermark{font-size:34px}
}
</style>
</head>
<body>${body}</body>
</html>`;
}

app.get("/", async (req, res) => {
  const title = await getSetting("website_title", "AEGIS Command Operations System");
  const msg = await getSetting("homepage_message", "Official GTA RP Government Infrastructure");
  const maintenance = await getSetting("maintenance_mode", "false");

  res.send(layout(title, `
<div class="watermark">AEGIS COMMAND SYSTEM</div>
<header class="header">
  <div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(msg)}</p>
  </div>
  <div class="seal">AEGIS</div>
</header>
<section class="hero">
  <h2>Secure GTA RP Government Infrastructure</h2>
  <p>Discord • CAD • FiveM • DMV • Court • Business • Recruitment • AI Operations • Maintenance</p>
  ${maintenance === "true" ? `<div class="card warn"><b>Maintenance Mode Active</b><br>Some systems may be limited.</div>` : ""}
  <p><a href="/cad">Enter AEGIS CAD Operations Network</a></p>
  <p><a href="/admin">Enter Admin Panel</a></p>
  <p><a href="/maintenance">Maintenance Division</a></p>
  <p><a href="/health">System Health</a></p>
</section>`));
});

app.get("/health", (req, res) => res.json(status));

app.get("/cad", async (req, res) => {
  const notice = await getSetting("cad_notice", "AEGIS does not show fake live activity.");
  res.send(layout("AEGIS CAD Operations Network", `
<header class="header">
  <div>
    <h1>AEGIS CAD Operations Network</h1>
    <p>Standalone dispatch and government operations environment.</p>
  </div>
  <div class="seal">CAD</div>
</header>
<div class="grid">
  <div class="card"><h2>Dispatch</h2><p>No active calls detected.</p></div>
  <div class="card"><h2>FiveM Bridge</h2><p class="${status.fivem === "online" ? "good" : "warn"}">${status.fivem === "online" ? "Connected" : "Waiting for FiveM heartbeat."}</p></div>
  <div class="card"><h2>Active Units</h2><p>No active units currently on duty.</p></div>
  <div class="card"><h2>AI Operations</h2><p>${escapeHtml(status.ai)}</p></div>
  <div class="card"><h2>Database</h2><p>${escapeHtml(status.database)}</p></div>
  <div class="card"><h2>Discord Bot</h2><p>${escapeHtml(status.bot)}</p></div>
  <div class="card"><h2>Truth Mode</h2><p>${escapeHtml(notice)}</p></div>
</div>`));
});

app.get("/admin", async (req, res) => {
  const title = await getSetting("website_title", "AEGIS Command Operations System");
  const homepage = await getSetting("homepage_message", "");
  const cadNotice = await getSetting("cad_notice", "");
  const maintenance = await getSetting("maintenance_mode", "false");

  res.send(layout("AEGIS Admin Panel", `
<div class="sidebar">
  <h2>AEGIS ADMIN</h2>
  <a href="/">Home</a>
  <a href="/cad">CAD Operations</a>
  <a href="/maintenance">Maintenance</a>
  <a href="/business">Business Registry</a>
  <a href="/recruitment">Recruitment</a>
  <a href="/health">Health JSON</a>
</div>
<div class="main">
  <h1>Command Administration Panel</h1>
  <div class="card">
    <h2>Live Settings Update</h2>
    <input id="website_title" value="${escapeHtml(title)}" placeholder="Website Title">
    <input id="homepage_message" value="${escapeHtml(homepage)}" placeholder="Homepage Message">
    <textarea id="cad_notice" placeholder="CAD Notice">${escapeHtml(cadNotice)}</textarea>
    <select id="maintenance_mode">
      <option value="false" ${maintenance === "false" ? "selected" : ""}>Maintenance Off</option>
      <option value="true" ${maintenance === "true" ? "selected" : ""}>Maintenance On</option>
    </select>
    <button onclick="saveSettings()">Save Settings</button>
    <p id="result"></p>
  </div>
  <div class="card">
    <h2>System Status</h2>
    <pre>${escapeHtml(JSON.stringify(status, null, 2))}</pre>
  </div>
</div>
<script>
async function saveSettings(){
  const updates = {
    website_title: document.getElementById("website_title").value,
    homepage_message: document.getElementById("homepage_message").value,
    cad_notice: document.getElementById("cad_notice").value,
    maintenance_mode: document.getElementById("maintenance_mode").value
  };
  const res = await fetch("/api/settings/bulk", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(updates)
  });
  const data = await res.json();
  document.getElementById("result").innerText = data.success ? "Saved." : data.error;
}
</script>`));
});

app.get("/maintenance", async (req, res) => {
  let logs = [];
  if (db) {
    try {
      const result = await db.query("SELECT type,message,created_at FROM system_logs ORDER BY created_at DESC LIMIT 35");
      logs = result.rows;
    } catch {}
  }

  const envView = protectedEnvView();

  res.send(layout("AEGIS Maintenance Division", `
<div class="sidebar">
  <h2>MAINTENANCE</h2>
  <a href="/">Home</a>
  <a href="/admin">Admin Panel</a>
  <a href="/cad">CAD</a>
  <a href="/health">Health JSON</a>
</div>
<div class="main">
  <h1>AEGIS Maintenance & Infrastructure Division</h1>
  <p>Official technical operations environment for AEGIS infrastructure.</p>

  <div class="grid" style="padding:0">
    <div class="card"><h3>Website</h3><p>${escapeHtml(status.website)}</p></div>
    <div class="card"><h3>Discord Bot</h3><p>${escapeHtml(status.bot)}</p></div>
    <div class="card"><h3>Database</h3><p>${escapeHtml(status.database)}</p></div>
    <div class="card"><h3>AI</h3><p>${escapeHtml(status.ai)}</p></div>
    <div class="card"><h3>FiveM</h3><p>${escapeHtml(status.fivem)}</p></div>
    <div class="card"><h3>Version</h3><p>${escapeHtml(status.version)}</p></div>
  </div>

  <div class="card">
    <h2>Protected Environment Variables</h2>
    <pre>${escapeHtml(JSON.stringify(envView, null, 2))}</pre>
  </div>

  <div class="terminal">
    <div class="terminal-title">AEGIS LIVE SYSTEM STREAM</div>
    <div class="terminal-body">
      <p>&gt; Loading AEGIS runtime...</p>
      <p>&gt; Website server: ${escapeHtml(status.website)}</p>
      <p>&gt; Discord bot core: ${escapeHtml(status.bot)}</p>
      <p>&gt; CAD network: ${escapeHtml(status.cad)}</p>
      <p>&gt; FiveM bridge: ${escapeHtml(status.fivem)}</p>
      <p>&gt; AI engine: ${escapeHtml(status.ai)}</p>
      <p>&gt; Database: ${escapeHtml(status.database)}</p>
      <p>&gt; Last error: ${escapeHtml(status.lastError || "None")}</p>
    </div>
  </div>

  <div class="card">
    <h2>Recent System Logs</h2>
    <pre>${escapeHtml(JSON.stringify(logs, null, 2))}</pre>
  </div>
</div>`));
});

app.get("/business", async (req, res) => {
  let rows = [];
  if (db) {
    try {
      const result = await db.query("SELECT * FROM businesses ORDER BY created_at DESC LIMIT 25");
      rows = result.rows;
    } catch {}
  }
  res.send(layout("AEGIS Business Registry", `
<div class="main" style="margin-left:0">
  <h1>AEGIS Business Registry Division</h1>
  <div class="card">
    <h2>Business Registry</h2>
    <p>Player-owned business records, licensing, employees, assets, reports, and compliance status.</p>
    <pre>${escapeHtml(JSON.stringify(rows, null, 2))}</pre>
  </div>
</div>`));
});

app.get("/recruitment", async (req, res) => {
  let rows = [];
  if (db) {
    try {
      const result = await db.query("SELECT * FROM applications ORDER BY created_at DESC LIMIT 25");
      rows = result.rows;
    } catch {}
  }
  res.send(layout("AEGIS Recruitment Division", `
<div class="main" style="margin-left:0">
  <h1>AEGIS Recruitment & Employment Division</h1>
  <div class="card">
    <h2>Applications</h2>
    <p>Department applications, academy tracking, interviews, staff reviews, and hiring operations.</p>
    <pre>${escapeHtml(JSON.stringify(rows, null, 2))}</pre>
  </div>
</div>`));
});

app.post("/api/settings/bulk", async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body || {})) {
      await setSetting(key, String(value));
    }
    await logSystem("SETTINGS_UPDATE", JSON.stringify(req.body));
    res.json({ success: true });
  } catch (err) {
    reportError("settings", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/fivem/heartbeat", (req, res) => {
  status.fivem = "online";
  status.lastFiveMHeartbeat = new Date().toISOString();
  res.json({ success: true, message: "AEGIS FiveM heartbeat received" });
});

app.post("/api/fivem/event", async (req, res) => {
  status.fivem = "online";
  status.lastFiveMEvent = req.body?.type || "unknown";

  if (db) {
    try {
      await db.query(
        "INSERT INTO fivem_events(guild_id,event_type,payload) VALUES($1,$2,$3)",
        [req.body?.guildId || null, req.body?.type || "unknown", req.body]
      );
    } catch (err) {
      reportError("database", err);
    }
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  status.website = "online";
  console.log(`AEGIS website running on port ${PORT}`);
});

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
    .setName("admin")
    .setDescription("Get the AEGIS admin panel link.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Get the AEGIS maintenance panel link.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setup-server")
    .setDescription("Auto-create AEGIS Discord infrastructure.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setup-fivem")
    .setDescription("Generate a FiveM bridge API key.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("update-website-title")
    .setDescription("Update the website title.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("title").setDescription("New website title").setRequired(true)),

  new SlashCommandBuilder()
    .setName("update-homepage-message")
    .setDescription("Update the homepage message.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("message").setDescription("New homepage message").setRequired(true)),

  new SlashCommandBuilder()
    .setName("update-cad-notice")
    .setDescription("Update the CAD notice.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("notice").setDescription("New CAD notice").setRequired(true)),

  new SlashCommandBuilder()
    .setName("maintenance-mode")
    .setDescription("Turn website maintenance mode on or off.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("mode")
        .setDescription("on or off")
        .setRequired(true)
        .addChoices({ name: "on", value: "true" }, { name: "off", value: "false" })
    )
].map(c => c.toJSON());

async function registerCommands() {
  try {
    if (!process.env.TOKEN || !process.env.CLIENT_ID) {
      status.commands = "missing_TOKEN_or_CLIENT_ID";
      return;
    }

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    status.commands = "registered";
    console.log("Slash commands registered");
  } catch (err) {
    status.commands = "error";
    reportError("commands", err);
  }
}

async function startBot() {
  try {
    if (!process.env.TOKEN) {
      status.bot = "missing_TOKEN";
      return;
    }

    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    client.once("clientReady", async () => {
      status.bot = "online";
      console.log(`AEGIS bot online as ${client.user.tag}`);
      await registerCommands();

      for (const guild of client.guilds.cache.values()) {
        await ensureServer(guild).catch(err => reportError("database", err));
      }

      await notifyOwner("SYSTEM ONLINE", `AEGIS is online.\n${BASE_URL}`);
    });

    client.on("guildCreate", async guild => {
      await ensureServer(guild).catch(err => reportError("database", err));
      await setupDiscordServer(guild).catch(err => reportError("setup", err));

      const owner = await guild.fetchOwner().catch(() => null);
      if (owner) {
        await owner.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x003366)
              .setTitle("🚨 AEGIS COMMAND SYSTEM DEPLOYED")
              .setDescription("Official GTA RP government infrastructure initialized.")
              .addFields(
                { name: "Portal", value: serverUrl(guild) },
                { name: "CAD", value: `${BASE_URL}/cad` },
                { name: "Admin", value: `${BASE_URL}/admin` }
              )
              .setTimestamp()
          ]
        }).catch(() => {});
      }
    });

    client.on("interactionCreate", async interaction => {
      try {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === "status") {
          return interaction.reply({ content: "```json\n" + JSON.stringify(status, null, 2) + "\n```", ephemeral: true });
        }

        if (interaction.commandName === "cad") {
          return interaction.reply({ content: `${BASE_URL}/cad`, ephemeral: true });
        }

        if (interaction.commandName === "admin") {
          return interaction.reply({ content: `${BASE_URL}/admin`, ephemeral: true });
        }

        if (interaction.commandName === "maintenance") {
          return interaction.reply({ content: `${BASE_URL}/maintenance`, ephemeral: true });
        }

        if (interaction.commandName === "portal") {
          const accessCode = makeCode();
          if (db) {
            await db.query(
              "INSERT INTO access_codes(code,user_id,guild_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [accessCode, interaction.user.id, interaction.guildId || "unknown"]
            ).catch(err => reportError("database", err));
          }

          await interaction.user.send(
            `🚨 **AEGIS COMMAND PORTAL**\n\nAccess Code: **${accessCode}**\nPortal: ${BASE_URL}\n\nDo not share this code.`
          ).catch(() => {});

          return interaction.reply({ content: "📩 AEGIS access code sent to your DMs.", ephemeral: true });
        }

        if (interaction.commandName === "setup-server") {
          await interaction.deferReply({ ephemeral: true });
          await setupDiscordServer(interaction.guild);
          return interaction.editReply("✅ AEGIS Discord infrastructure created/verified.");
        }

        if (interaction.commandName === "setup-fivem") {
          const apiKey = makeKey();
          if (db) {
            await db.query(
              `INSERT INTO servers(guild_id,name,slug,fivem_api_key,fivem_enabled,updated_at)
               VALUES($1,$2,$3,$4,true,NOW())
               ON CONFLICT(guild_id)
               DO UPDATE SET fivem_api_key=$4, fivem_enabled=true, updated_at=NOW()`,
              [interaction.guildId, interaction.guild?.name || "unknown", slugify(interaction.guild?.name || "server"), apiKey]
            ).catch(err => reportError("database", err));
          }

          return interaction.reply({
            content:
              `✅ **AEGIS FiveM Bridge Generated**\n\n` +
              `API URL:\n${BASE_URL}/api/fivem/event\n\n` +
              `Heartbeat URL:\n${BASE_URL}/api/fivem/heartbeat\n\n` +
              `Guild ID:\n${interaction.guildId}\n\n` +
              `API Key:\n\`${apiKey}\``,
            ephemeral: true
          });
        }

        if (interaction.commandName === "update-website-title") {
          const value = interaction.options.getString("title");
          await setSetting("website_title", value);
          return interaction.reply({ content: "✅ Website title updated.", ephemeral: true });
        }

        if (interaction.commandName === "update-homepage-message") {
          const value = interaction.options.getString("message");
          await setSetting("homepage_message", value);
          return interaction.reply({ content: "✅ Homepage message updated.", ephemeral: true });
        }

        if (interaction.commandName === "update-cad-notice") {
          const value = interaction.options.getString("notice");
          await setSetting("cad_notice", value);
          return interaction.reply({ content: "✅ CAD notice updated.", ephemeral: true });
        }

        if (interaction.commandName === "maintenance-mode") {
          const value = interaction.options.getString("mode");
          await setSetting("maintenance_mode", value);
          return interaction.reply({ content: `✅ Maintenance mode set to ${value === "true" ? "ON" : "OFF"}.`, ephemeral: true });
        }
      } catch (err) {
        reportError("interaction", err);
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({ content: `❌ AEGIS error: ${err.message}`, ephemeral: true }).catch(() => {});
        }
        return interaction.editReply(`❌ AEGIS error: ${err.message}`).catch(() => {});
      }
    });

    client.login(process.env.TOKEN).catch(err => {
      status.bot = "login_failed";
      reportError("bot", err);
    });
  } catch (err) {
    reportError("bot", err);
  }
}

async function startAI() {
  if (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) {
    status.ai = "configured";
  } else {
    status.ai = "not_attached";
  }
}

(async () => {
  try {
    await initDatabase();
  } catch (err) {
    reportError("database", err);
  }

  try {
    await startAI();
  } catch (err) {
    reportError("ai", err);
  }

  try {
    await startBot();
  } catch (err) {
    reportError("bot", err);
  }

  setInterval(async () => {
    await logSystem("DIAGNOSTIC", JSON.stringify(status));
  }, 10 * 60 * 1000);

  console.log("AEGIS safe startup complete");
})();