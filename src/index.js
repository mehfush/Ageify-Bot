require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField, ChannelType
} = require('discord.js');
const db = require('./database');
const { sendLogs, helpEmbed, isStaff } = require('./commands');
const { isImageAttachment, truncate } = require('./utils');

if (!process.env.DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN in .env');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message]
});

const activeUploadChannels = new Map();

function privacyText() {
  return [
    '🔒 **Privacy Notice**',
    'Your photo is collected only for age verification.',
    'It will not be used for another purpose, shared, or published by this bot.',
    'The bot deletes the verification messages/channel after the review is completed.',
    'Only verification metadata such as the result, reviewer, time, and rejection reason is kept.'
  ].join('\n');
}

function panelEmbed() {
  return new EmbedBuilder().setTitle('🔐 Age Verification').setDescription([
    'Choose your age group below to continue.', '',
    '🧒 **Minor** — receive the Minor role.',
    '🔞 **18+** — submit a photo for manual admin review.', '',
    privacyText()
  ].join('\n')).setColor(0x5865F2).setFooter({ text: 'Choose the correct option. False information may result in a blacklist.' });
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('age_minor').setLabel('Minor').setEmoji('🧒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('age_adult').setLabel('18+').setEmoji('🔞').setStyle(ButtonStyle.Danger)
  );
}

function configMissing(config) {
  const needed = [
    ['verificationChannelId', 'Verification channel'],
    ['minorRoleId', 'Minor role'],
    ['adultRoleId', '18+ role'],
    ['approvalChannelId', 'Approval channel'],
    ['logsChannelId', 'Logs channel'],
    ['uploadCategoryId', 'Upload category'],
    ['approvalRoleId', 'Approval role']
  ];
  return needed.filter(([key]) => !config[key]).map(([, label]) => label);
}

function setupError(message, details = '') {
  return new EmbedBuilder()
    .setTitle('⚠️ Setup Error')
    .setDescription([`**${message}**`, details].filter(Boolean).join('\n\n'))
    .setColor(0xED4245);
}

async function createUploadChannel(interaction) {
  const guild = interaction.guild;
  const config = db.getGuild(guild.id);
  const missing = configMissing(config);
  if (missing.length) return interaction.reply({ content: `⚠️ Setup is incomplete: ${missing.join(', ')}.`, ephemeral: true });
  if (db.getBlacklist(guild.id, interaction.user.id)) return interaction.reply({ content: '🚫 You are blacklisted from age verification.', ephemeral: true });
  if (db.getPending(interaction.user.id)) return interaction.reply({ content: '🟡 You already have a verification request in progress.', ephemeral: true });

  const category = await guild.channels.fetch(config.uploadCategoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ content: '⚠️ The configured upload category no longer exists.', ephemeral: true });

  let channel;
  try {
    channel = await guild.channels.create({
      name: `verify-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80) || `verify-${interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.approvalRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    });
  } catch (error) {
    console.error('[UPLOAD CHANNEL ERROR]', error);
    return interaction.reply({ embeds: [setupError('I could not create your private verification channel.', 'The bot needs **Manage Channels** permission, and the configured upload category must allow the bot to create channels.')], ephemeral: true });
  }

  db.setPending(interaction.user.id, { guildId: guild.id, uploadChannelId: channel.id, createdAt: Date.now(), status: 'awaiting_photo' });
  activeUploadChannels.set(channel.id, interaction.user.id);

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setTitle('🔞 18+ Verification').setDescription(['Upload **one clear photo of yourself** in this channel.', '', 'The photo is sent only to the configured approval team for manual review.', '', privacyText(), '', '⚠️ Do not upload IDs, passports, addresses, or other private documents.'].join('\n')).setColor(0xED4245)] });
  return interaction.reply({ content: `🔒 A private verification channel has been created: ${channel}`, ephemeral: true });
}

async function processPhoto(message) {
  if (!message.guild || message.author.bot) return;
  const userId = activeUploadChannels.get(message.channel.id);
  if (!userId || message.author.id !== userId) return;
  const pending = db.getPending(userId);
  if (!pending || pending.status !== 'awaiting_photo') return;

  const image = [...message.attachments.values()].find(isImageAttachment);
  if (!image) {
    await message.delete().catch(() => {});
    await message.channel.send({ content: `<@${userId}> Please upload an image file (PNG, JPG, GIF or WEBP).` }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
    return;
  }
  if (message.attachments.size !== 1) {
    await message.delete().catch(() => {});
    await message.channel.send({ content: `<@${userId}> Please upload exactly one photo.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
    return;
  }

  const config = db.getGuild(message.guild.id);
  const approvalChannel = await message.guild.channels.fetch(config.approvalChannelId).catch(() => null);
  if (!approvalChannel?.isTextBased()) {
    await message.channel.send({ content: `<@${userId}> ⚠️ I could not find the configured approval channel. Please contact a server admin.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
    console.error(`[PHOTO ERROR] Invalid approval channel for guild ${message.guild.id}: ${config.approvalChannelId}`);
    return;
  }

  const embed = new EmbedBuilder().setTitle('🔞 New 18+ Verification').setDescription([
    `**User:** <@${userId}>`,
    `**User ID:** \`${userId}\``,
    '**Status:** 🟡 Pending', '',
    privacyText()
  ].join('\n')).setColor(0xFEE75C).setTimestamp();

  let approvalMessage;
  try {
    approvalMessage = await approvalChannel.send({
      content: `<@&${config.approvalRoleId}>`,
      embeds: [embed],
      files: [{ attachment: image.url, name: `verification-${userId}.${(image.name?.split('.').pop() || 'jpg').slice(0, 5)}` }],
      allowedMentions: { roles: [config.approvalRoleId] },
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve:${userId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject:${userId}`).setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger)
      )]
    });
  } catch (error) {
    console.error('[APPROVAL MESSAGE ERROR]', error);
    await message.channel.send({ content: `<@${userId}> ⚠️ Your photo could not be submitted to the approval team. Please contact a server admin.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 10000)).catch(() => {});
    return;
  }

  pending.status = 'pending_review';
  pending.approvalChannelId = approvalChannel.id;
  pending.approvalMessageId = approvalMessage.id;
  pending.submittedAt = Date.now();
  db.setPending(userId, pending);
  await sendLogs(message.guild, 'submitted', { User: `<@${userId}>`, 'User ID': userId, Status: 'Pending' });
  await message.delete().catch(() => {});
  activeUploadChannels.delete(message.channel.id);
  await message.channel.delete('Verification photo submitted for admin review').catch(() => {});
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      const config = db.getGuild(interaction.guild.id);
      if (interaction.commandName === 'help') return interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
      if (interaction.commandName === 'postpanel') {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Administrator permission is required.', ephemeral: true });
        const missing = configMissing(config);
        if (missing.length) return interaction.reply({ embeds: [setupError('Setup is incomplete.', `Missing: **${missing.join(', ')}**\n\nRun `/setup` and provide all required settings.`)], ephemeral: true });
        const targetId = config.verificationChannelId;
        const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);
        if (!channel?.isTextBased()) return interaction.reply({ embeds: [setupError('The configured verification channel cannot be found.', `Channel ID: \`${targetId}\`\n\nRun `/setup` again and select a valid text channel.`)], ephemeral: true });
        try {
          await channel.send({ embeds: [panelEmbed()], components: [panelRow()] });
        } catch (error) {
          console.error('[POSTPANEL ERROR]', error);
          return interaction.reply({ embeds: [setupError('I could not send the verification panel.', 'Make sure I can **View Channel**, **Send Messages**, **Embed Links**, and **Use External Emojis** if needed in that channel.')], ephemeral: true });
        }
        return interaction.reply({ content: `✅ Verification panel posted in ${channel}.`, ephemeral: true });
      }
      if (interaction.commandName === 'setup') {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Administrator permission is required.', ephemeral: true });
        const patch = {};
        const map = [
          ['verification_channel','verificationChannelId'],
          ['approval_channel','approvalChannelId'],
          ['logs_channel','logsChannelId'],
          ['upload_category','uploadCategoryId'],
          ['approval_role','approvalRoleId'],
          ['minor_role','minorRoleId'],
          ['adult_role','adultRoleId']
        ];
        for (const [option, key] of map) {
          const value = interaction.options.get(option);
          if (!value) continue;
          // Discord.js option resolvers return an option object. The selected
          // channel/role ID is in .value (and the resolved object is in
          // .channel/.role), not directly in .id.
          const id = value.channel?.id || value.role?.id || value.value;
          if (id) patch[key] = id;
        }
        if (!Object.keys(patch).length) {
          const current = configMissing(config);
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚙️ Age Verification Setup').setDescription([
            `**Verification channel:** ${config.verificationChannelId ? `<#${config.verificationChannelId}>` : '❌ Not set'}`,
            `**Approval channel:** ${config.approvalChannelId ? `<#${config.approvalChannelId}>` : '❌ Not set'}`,
            `**Logs channel:** ${config.logsChannelId ? `<#${config.logsChannelId}>` : '❌ Not set'}`,
            `**Upload category:** ${config.uploadCategoryId ? `<#${config.uploadCategoryId}>` : '❌ Not set'}`,
            `**Approval role:** ${config.approvalRoleId ? `<@&${config.approvalRoleId}>` : '❌ Not set'}`,
            `**Minor role:** ${config.minorRoleId ? `<@&${config.minorRoleId}>` : '❌ Not set'}`,
            `**18+ role:** ${config.adultRoleId ? `<@&${config.adultRoleId}>` : '❌ Not set'}`,
            '',
            current.length ? `❌ **Still missing:** ${current.join(', ')}` : '✅ **Setup is complete.** Use `/postpanel` to post the panel.'
          ].join('\n')).setColor(current.length ? 0xED4245 : 0x57F287)], ephemeral: true });
        }
        // Validate selected channels and roles before saving.
        const types = [
          ['verificationChannelId', ChannelType.GuildText, 'verification channel'],
          ['approvalChannelId', ChannelType.GuildText, 'approval channel'],
          ['logsChannelId', ChannelType.GuildText, 'logs channel'],
          ['uploadCategoryId', ChannelType.GuildCategory, 'upload category']
        ];
        for (const [key, type, label] of types) {
          if (!patch[key]) continue;
          const ch = await interaction.guild.channels.fetch(patch[key]).catch(() => null);
          if (!ch || ch.type !== type) return interaction.reply({ embeds: [setupError(`Invalid ${label}.`, `Please select a valid ${type === ChannelType.GuildCategory ? 'category' : 'text channel'}.`)], ephemeral: true });
        }
        for (const [key, label] of [['approvalRoleId','approval role'],['minorRoleId','Minor role'],['adultRoleId','18+ role']]) {
          if (!patch[key]) continue;
          const role = await interaction.guild.roles.fetch(patch[key]).catch(() => null);
          if (!role) return interaction.reply({ embeds: [setupError(`Invalid ${label}.`, 'Please select a role that still exists in this server.')], ephemeral: true });
        }
        const updated = db.setGuild(interaction.guild.id, patch);
        const missing = configMissing(updated);
        if (missing.length) {
          return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Setup saved, but it is incomplete').setDescription(`The settings were saved.\n\n**Still missing:** ${missing.join(', ')}\n\nRun \`/setup\` again to finish it.`).setColor(0xFEE75C)], ephemeral: true });
        }
        const channel = await interaction.guild.channels.fetch(updated.verificationChannelId).catch(() => null);
        if (!channel?.isTextBased()) return interaction.reply({ embeds: [setupError('Setup was saved, but the verification channel cannot be accessed.', 'Check that the bot can View Channel and Send Messages there.')], ephemeral: true });
        try {
          await channel.send({ embeds: [panelEmbed()], components: [panelRow()] });
        } catch (error) {
          console.error('[SETUP PANEL ERROR]', error);
          return interaction.reply({ embeds: [setupError('Setup was saved, but I could not post the verification panel.', 'Give the bot **View Channel**, **Send Messages**, and **Embed Links** in the verification channel.')], ephemeral: true });
        }
        return interaction.reply({ content: '✅ Setup saved and the verification panel was posted.', ephemeral: true });
      }
      if (['blacklist','unblacklist','blacklistinfo'].includes(interaction.commandName)) {
        if (!isStaff(interaction.member, config)) return interaction.reply({ content: '❌ You are not allowed to use this command.', ephemeral: true });
        const user = interaction.options.getUser('user');
        if (interaction.commandName === 'blacklist') {
          const reason = interaction.options.getString('reason', true);
          db.blacklist(interaction.guild.id, user.id, { reason, by: interaction.user.id, at: Date.now() });
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member) await member.roles.remove([config.minorRoleId, config.adultRoleId].filter(Boolean)).catch(() => {});
          await sendLogs(interaction.guild, 'blacklist', { User: `<@${user.id}>`, Moderator: `<@${interaction.user.id}>`, Reason: reason });
          return interaction.reply({ content: `🚫 ${user.tag} has been blacklisted.`, ephemeral: true });
        }
        if (interaction.commandName === 'unblacklist') {
          db.unblacklist(interaction.guild.id, user.id);
          await sendLogs(interaction.guild, 'unblacklist', { User: `<@${user.id}>`, Moderator: `<@${interaction.user.id}>` });
          return interaction.reply({ content: `♻️ ${user.tag} has been removed from the blacklist.`, ephemeral: true });
        }
        const record = db.getBlacklist(interaction.guild.id, user.id);
        return interaction.reply({ content: record ? `🚫 **Blacklisted**\nReason: ${record.reason}\nBy: <@${record.by}>\nDate: <t:${Math.floor(record.at / 1000)}:F>` : `✅ ${user.tag} is not blacklisted.`, ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'age_minor') {
        const config = db.getGuild(interaction.guild.id);
        if (db.getBlacklist(interaction.guild.id, interaction.user.id)) return interaction.reply({ content: '🚫 You are blacklisted from verification.', ephemeral: true });
        if (!config.minorRoleId) return interaction.reply({ content: '⚠️ The Minor role has not been configured.', ephemeral: true });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.remove([config.adultRoleId].filter(Boolean)).catch(() => {});
        await member.roles.add(config.minorRoleId);
        await sendLogs(interaction.guild, 'minor', { User: `<@${interaction.user.id}>`, 'User ID': interaction.user.id, Role: `<@&${config.minorRoleId}>` });
        return interaction.reply({ content: '🧒 You have been verified as a minor.', ephemeral: true });
      }
      if (interaction.customId === 'age_adult') return createUploadChannel(interaction);

      const [action, userId] = interaction.customId.split(':');
      if (action === 'approve' || action === 'reject') {
        const config = db.getGuild(interaction.guild.id);
        if (!isStaff(interaction.member, config)) return interaction.reply({ content: '❌ Only the configured approval team can review verifications.', ephemeral: true });
        const pending = db.getPending(userId);
        if (!pending || pending.status !== 'pending_review') return interaction.reply({ content: '⚠️ This verification is no longer pending.', ephemeral: true });
        if (action === 'reject') {
          const modal = new ModalBuilder().setCustomId(`reject_modal:${userId}`).setTitle('Reject Verification');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason for rejection').setPlaceholder('Explain why the photo was rejected...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
          return interaction.showModal(modal);
        }
        await interaction.deferUpdate();
        return finishDecision(interaction.guild, interaction, userId, true);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_modal:')) {
      const userId = interaction.customId.split(':')[1];
      const config = db.getGuild(interaction.guild.id);
      if (!isStaff(interaction.member, config)) return interaction.reply({ content: '❌ You are not allowed to reject this verification.', ephemeral: true });
      const reason = interaction.fields.getTextInputValue('reason').trim();
      if (!reason) return interaction.reply({ content: '❌ A rejection reason is required.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await finishDecision(interaction.guild, interaction, userId, false, reason);
      return interaction.editReply('❌ Verification rejected. The photo review message has been removed.');
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: '⚠️ Something went wrong while processing this action.', ephemeral: true }).catch(() => {});
  }
});

async function finishDecision(guild, interaction, userId, approved, reason = null) {
  const config = db.getGuild(guild.id);
  const pending = db.getPending(userId);
  if (!pending || pending.status !== 'pending_review') return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    if (approved) {
      await member.roles.remove([config.minorRoleId].filter(Boolean)).catch(() => {});
      await member.roles.add(config.adultRoleId).catch(() => {});
    } else {
      await member.roles.remove([config.adultRoleId].filter(Boolean)).catch(() => {});
    }
  }
  const approvalChannel = await guild.channels.fetch(pending.approvalChannelId).catch(() => null);
  const approvalMessage = approvalChannel?.isTextBased() ? await approvalChannel.messages.fetch(pending.approvalMessageId).catch(() => null) : null;
  if (approvalMessage) await approvalMessage.delete().catch(() => {});
  db.deletePending(userId);
  await sendLogs(guild, approved ? 'approved' : 'rejected', { User: `<@${userId}>`, Reviewer: `<@${interaction.user.id}>`, Result: approved ? 'Approved' : 'Rejected', ...(reason ? { Reason: reason } : {}) });
  const user = await client.users.fetch(userId).catch(() => null);
  if (user) await user.send({ embeds: [new EmbedBuilder().setTitle(approved ? '✅ 18+ Verification Approved' : '❌ 18+ Verification Rejected').setDescription(approved ? 'Your 18+ verification has been approved.' : `Your 18+ verification was rejected.\n\n**Reason:** ${truncate(reason, 1000)}\n\nYou may submit another photo if verification is available.`).setColor(approved ? 0x57F287 : 0xED4245)] }).catch(() => {});
}

client.on('messageCreate', processPhoto);
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
