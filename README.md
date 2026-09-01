# GojoBot

A Discord verification bot with:

- default prefix: `>`
- slash commands
- editable custom commands from a JSON config file
- verification flow with a code check
- optional success message in plain text or embed form
- role assignment after verification
- optional image support for verification and custom command responses

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Edit the values in `config/config.json`:
   - `token`
   - `clientId`
   - `guildId`
   - `verification.roleId`
   - `verification.channelId`
   - `verification.requiredCode`
   - `prefix`

3. Start the bot:
   ```bash
   npm start
   ```

## Custom commands

You can edit the commands in `config/custom-commands.json` or in the `customCommands` section of `config/config.json`.

Example:

```json
{
  "name": "help",
  "description": "Show help",
  "response": "Hello {username}! Use `>verify`.",
  "replyType": "text"
}
```

Then restart the bot or use `/reloadcommands`.

## Slash commands

- `/verify` -> opens a verification modal
- `/reloadcommands` -> reloads custom command config without restarting the bot

## Prefix commands

- `>verify <code>`
- `>ping`
- `>hello`

## Important

To make a verification role effectively hidden in Discord, create the role, turn off the things you do not want visible in server settings, and assign it to members only after verification.
