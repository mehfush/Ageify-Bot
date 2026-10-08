# Discord Age Verification Bot

A multi-server Discord bot for:
- Minor / 18+ verification
- Private temporary photo-upload channels
- Manual approval/rejection by an approval role
- Required rejection reason
- Approval-role ping on new submissions
- Minor and 18+ roles
- Verification logs
- Blacklist with reason
- Persistent configuration in `data/database.json`

## Requirements
- Node.js 20+
- Discord bot with `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent` intents.
- Bot permissions: Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages.

## Setup
1. Copy `.env.example` to `.env`.
2. Put the bot token and application/client ID in `.env`.
3. Run `npm install`.
4. Run `npm run deploy` once to register slash commands globally.
5. Run `npm start`.
6. In your server run `/setup` and select the channels, roles and upload category.
7. Run `/verify` or place your own verification panel in the verification channel with `/verify`.

## Privacy behavior
The bot does not put submitted photos into its JSON database. The approval message contains the photo only while the request is pending. After approval/rejection, the bot deletes the approval message and the temporary upload channel. Verification records retain only metadata such as status, reviewer, time and rejection reason.

Discord/CDN caching is controlled by Discord, so the bot should not promise instant physical erasure from every Discord cache. The bot itself deletes the Discord messages/channels as soon as the review is completed.
