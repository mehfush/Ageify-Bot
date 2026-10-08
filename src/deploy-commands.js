require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required.');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands() });
  console.log('Slash commands deployed globally.');
})();
