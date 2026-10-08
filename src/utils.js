const { PermissionFlagsBits } = require('discord.js');

function isStaff(member, config) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    (config?.approvalRoleId && member.roles.cache.has(config.approvalRoleId));
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || '');
}

function truncate(text, max = 1000) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { isStaff, isImageAttachment, truncate };
