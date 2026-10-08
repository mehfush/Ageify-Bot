const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const db = require('./database');
const { isStaff, truncate } = require('./utils');

function commands() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Show the age verification bot help.'),
    new SlashCommandBuilder().setName('postpanel').setDescription('Post the permanent age verification panel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setup').setDescription('Configure the age verification system.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName('verification_channel').setDescription('Channel for the verification panel.').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('approval_channel').setDescription('Private admin approval channel.').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('logs_channel').setDescription('Channel for verification logs.').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('upload_category').setDescription('Category for temporary private upload channels.').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption(o => o.setName('approval_role').setDescription('Role to ping for new 18+ submissions.'))
      .addRoleOption(o => o.setName('minor_role').setDescription('Role given to users who select Minor.'))
      .addRoleOption(o => o.setName('adult_role').setDescription('Role given after 18+ approval.')),
    new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist a user from verification.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(o => o.setName('user').setDescription('User to blacklist.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the blacklist.').setRequired(true).setMaxLength(1000)),
    new SlashCommandBuilder().setName('unblacklist').setDescription('Remove a user from the verification blacklist.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(o => o.setName('user').setDescription('User to unblacklist.').setRequired(true)),
    new SlashCommandBuilder().setName('blacklistinfo').setDescription('Show blacklist information for a user.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(o => o.setName('user').setDescription('User to check.').setRequired(true))
  ].map(c => c.toJSON());
}

async function sendLogs(guild, type, fields) {
  const config = db.getGuild(guild.id);
  if (!config.logsChannelId) return;
  const channel = await guild.channels.fetch(config.logsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const colors = { approved: 0x57F287, rejected: 0xED4245, minor: 0x5865F2, submitted: 0xFEE75C, blacklist: 0xED4245, unblacklist: 0x57F287 };
  const titles = { approved: '18+ Verification Approved', rejected: '18+ Verification Rejected', minor: 'Minor Verified', submitted: '18+ Verification Submitted', blacklist: 'User Blacklisted', unblacklist: 'User Removed From Blacklist' };
  const embed = new EmbedBuilder().setTitle(titles[type] || 'Verification Log').setColor(colors[type] || 0x5865F2).setTimestamp();
  for (const [name, value] of Object.entries(fields)) embed.addFields({ name, value: truncate(String(value), 1024), inline: true });
  await channel.send({ embeds: [embed] }).catch(() => {});
}

function helpEmbed() {
  return new EmbedBuilder().setTitle('🔐 Age Verification Bot').setDescription([
    '**Member Verification**', 'Use the **Minor** or **18+** buttons in the verification channel. There is no `/verify` command.', '',
    '**Moderation**', '`/blacklist` — block a user from verification', '`/unblacklist` — remove a blacklist', '`/blacklistinfo` — view blacklist information', '',
    '**Configuration**', '`/setup` — configure channels, roles and the upload category', '',
    '18+ submissions are manually reviewed by the configured approval team. Rejection always requires a reason.'
  ].join('\n')).setColor(0x5865F2);
}

module.exports = { commands, sendLogs, helpEmbed, isStaff };
