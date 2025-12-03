import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { isRootAdmin } from '../utils/permissions';

export const data = new SlashCommandBuilder()
  .setName('adminstatus')
  .setDescription('Check if you are registered as a bot admin.');

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });
  const isAdmin = isRootAdmin(interaction.user);
  const message = isAdmin
    ? '✅ You are registered as a bot admin.'
    : '❌ You are not on the bot admin list.';
  await interaction.editReply(message);
}
