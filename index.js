require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("<h1>AEGIS Command Operations System Online</h1>");
});

app.get("/health", (req, res) => {
  res.json({
    website: "online",
    bot: global.botReady ? "online" : "offline_or_starting"
  });
});

app.listen(PORT, () => {
  console.log(`AEGIS running on port ${PORT}`);
});

if (process.env.TOKEN) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  client.once("ready", () => {
    global.botReady = true;
    console.log(`AEGIS bot online as ${client.user.tag}`);
  });

  client.login(process.env.TOKEN).catch(err => {
    console.error("Discord login failed:", err.message);
  });
} else {
  console.log("No TOKEN set. Website running without Discord bot.");
}