import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  Collection,
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config', 'config.json');
const customCommandsPath = path.join(rootDir, 'config', 'custom-commands.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildRuntimeConfig(rawConfig = {}) {
  return {
    ...rawConfig,
    token: process.env.DISCORD_TOKEN || rawConfig.token || '',
    clientId: process.env.CLIENT_ID || rawConfig.clientId || '',
    guildId: process.env.GUILD_ID || rawConfig.guildId || '',
    prefix: process.env.BOT_PREFIX || rawConfig.prefix || '>',
    verification: {
      ...(rawConfig.verification || {}),
      roleId: process.env.VERIFICATION_ROLE_ID || rawConfig.verification?.roleId || '',
      channelId: process.env.VERIFICATION_CHANNEL_ID || rawConfig.verification?.channelId || '',
      requiredCode: process.env.VERIFICATION_CODE || rawConfig.verification?.requiredCode || 'WELCOME',
      messageType: process.env.VERIFICATION_MESSAGE_TYPE || rawConfig.verification?.messageType || 'embed',
    },
  };
}

function loadConfig() {
  const rawConfig = readJson(configPath);
  const customCommands = readJson(customCommandsPath);
  return { config: buildRuntimeConfig(rawConfig), customCommands };
}

function formatTemplate(template, values = {}) {
  return String(template ?? '')
    .replaceAll('{user}', values.user ?? '')
    .replaceAll('{username}', values.username ?? '')
    .replaceAll('{guild}', values.guild ?? '')
    .replaceAll('{mention}', values.mention ?? '');
}

function buildCommandReply(command, user, guildName = '') {
  const responseText = formatTemplate(command.response || 'No response configured.', {
    user: `<@${user.id}>`,
    username: user.username,
    guild: guildName,
    mention: `<@${user.id}>`,
  });

  if (command.replyType === 'embed') {
    const embed = new EmbedBuilder()
      .setColor(command.color || '#5865F2')
      .setDescription(responseText);

    if (command.title) embed.setTitle(command.title);
    if (command.imageUrl) embed.setImage(command.imageUrl);
    if (command.thumbnailUrl) embed.setThumbnail(command.thumbnailUrl);

    return { embeds: [embed] };
  }

  return { content: responseText };
}

function buildVerificationSuccessPayload(member, guildName) {
  const verificationConfig = config.verification || {};
  const messageType = verificationConfig.messageType || 'embed';
  const text = formatTemplate(verificationConfig.successMessage || 'Verification complete! Welcome.', {
    user: `<@${member.user.id}>`,
    username: member.user.username,
    guild: guildName,
    mention: `<@${member.user.id}>`,
  });

  if (messageType === 'plain') {
    return { content: text, ephemeral: true };
  }

  const embed = new EmbedBuilder()
    .setTitle(verificationConfig.welcomeTitle || 'Verification complete')
    .setDescription(text)
    .setColor(verificationConfig.successEmbedColor || '#57F287');

  if (verificationConfig.imageUrl) embed.setImage(verificationConfig.imageUrl);

  return { embeds: [embed], ephemeral: true };
}

let { config, customCommands } = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();

function loadCustomCommands() {
  const data = readJson(customCommandsPath);
  client.commands.clear();
  for (const command of data) {
    client.commands.set(command.name.toLowerCase(), command);
  }
  return data;
}

async function registerSlashCommands() {
  const commandDefinitions = [
    ...loadCustomCommands().map((command) =>
      new SlashCommandBuilder()
        .setName(command.name.toLowerCase())
        .setDescription(command.description || `Custom command: ${command.name}`)
        .toJSON(),
    ),
    new SlashCommandBuilder().setName('verify').setDescription('Verify your account in this server').toJSON(),
    new SlashCommandBuilder().setName('reloadcommands').setDescription('Reload custom commands from the config file').toJSON(),
  ];

  await client.application.commands.set(commandDefinitions);
}

function makeVerificationModal() {
  const verificationConfig = config.verification || {};
  const modal = new ModalBuilder()
    .setCustomId('verify-modal')
    .setTitle(verificationConfig.modalTitle || 'Server Verification');

  const codeInput = new TextInputBuilder()
    .setCustomId('verify-code')
    .setLabel(verificationConfig.inputLabel || 'Enter your verification code')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(verificationConfig.codePlaceholder || 'Example: WELCOME');

  const actionRow = new ActionRowBuilder().addComponents(codeInput);
  modal.addComponents(actionRow);
  return modal;
}

async function handleVerification(member, guild, enteredCode) {
  const verificationConfig = config.verification || {};
  const expectedCode = String(verificationConfig.requiredCode || '').trim();

  if (!expectedCode) {
    return {
      success: false,
      message: 'No verification code has been configured yet.',
      ephemeral: true,
    };
  }

  if (String(enteredCode).trim().toLowerCase() !== expectedCode.trim().toLowerCase()) {
    return {
      success: false,
      message: verificationConfig.failureMessage || 'That code is incorrect. Please try again.',
      ephemeral: true,
    };
  }

  const roleId = verificationConfig.roleId;
  if (!roleId || roleId === 'PASTE_VERIFICATION_ROLE_ID_HERE') {
    return {
      success: false,
      message: 'Verification role is not configured. Please set verification.roleId in config/config.json.',
      ephemeral: true,
    };
  }

  let role = guild.roles.cache.get(roleId);
  if (!role) role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    return {
      success: false,
      message: 'The configured verification role could not be found. Please check the role ID.',
      ephemeral: true,
    };
  }

  await member.roles.add(role).catch(() => null);

  return {
    success: true,
    payload: buildVerificationSuccessPayload(member, guild.name),
  };
}

client.on(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerSlashCommands();
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const commandName = interaction.commandName.toLowerCase();

    if (commandName === 'verify') {
      await interaction.showModal(makeVerificationModal());
      return;
    }

    if (commandName === 'reloadcommands') {
      try {
        const { config: freshConfig, customCommands: freshCustomCommands } = loadConfig();
        config = freshConfig;
        customCommands = freshCustomCommands;
        await registerSlashCommands();
        await interaction.reply({ content: 'Custom commands reloaded successfully.', ephemeral: true });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Failed to reload commands.', ephemeral: true });
      }
      return;
    }

    const customCommand = client.commands.get(commandName);
    if (customCommand) {
      await interaction.reply(buildCommandReply(customCommand, interaction.user, interaction.guild?.name || 'this server'));
      return;
    }

    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'verify-modal') {
    const enteredCode = interaction.fields.getTextInputValue('verify-code');
    const result = await handleVerification(interaction.member, interaction.guild, enteredCode);

    if (!result.success) {
      await interaction.reply({ content: result.message, ephemeral: true });
      return;
    }

    await interaction.reply(result.payload);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const prefix = config.prefix || '>';
  if (!message.content.startsWith(prefix)) return;

  const content = message.content.slice(prefix.length).trim();
  if (!content) return;

  const [commandName, ...args] = content.split(/\s+/);
  const lowerName = commandName.toLowerCase();

  if (lowerName === 'verify') {
    const code = args.join(' ');
    if (!code) {
      await message.reply('Use `>verify <code>` to verify yourself.');
      return;
    }

    const result = await handleVerification(message.member, message.guild, code);
    if (!result.success) {
      await message.reply(result.message);
      return;
    }

    await message.reply(result.payload);
    return;
  }

  const customCommand = client.commands.get(lowerName);
  if (customCommand) {
    await message.reply(buildCommandReply(customCommand, message.author, message.guild?.name || 'this server'));
    return;
  }

  if (lowerName === 'help') {
    await message.reply('Available commands: `>verify <code>`, `>help`, and your custom commands.');
  }
});

client.login(config.token).catch((error) => {
  console.error('Failed to log in to Discord:', error);
  process.exit(1);
});
