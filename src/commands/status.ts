import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { sql } from 'drizzle-orm';
import { db } from '../db';

const buildMintStatus = async () => {
  const mintUrl = process.env.MINT_URL ?? '';
  if (!mintUrl) {
    return { label: 'Mint', status: '⚠️ MINT_URL not configured.' };
  }

  try {
    const normalized = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl;
    const url = `${normalized}/v1/info`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { label: 'Mint', status: `❌ ${response.status} ${response.statusText}` };
    }
    const info = (await response.json()) as { name?: string; version?: string };
    return {
      label: 'Mint',
      status: `✅ ${mintUrl} (${info.name ?? 'unknown'} – ${info.version ?? 'n/a'})`,
    };
  } catch (error: any) {
    return { label: 'Mint', status: `❌ ${error?.message ?? 'Unknown error'}` };
  }
};

const buildDatabaseStatus = async () => {
  try {
    await db.execute(sql`select 1`);
    return { label: 'Database', status: '✅ Connected' };
  } catch (error: any) {
    return { label: 'Database', status: `❌ ${error?.message ?? 'Connection failed'}` };
  }
};

const buildBotStatus = () => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const formatted = `${hours}h ${minutes}m ${seconds}s`;
  return { label: 'Bot', status: `✅ Online (uptime ${formatted})` };
};

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot, mint, and database status.');

export async function execute(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  const [mintStatus, dbStatus] = await Promise.all([buildMintStatus(), buildDatabaseStatus()]);
  const botStatus = buildBotStatus();

  const lines = [botStatus, mintStatus, dbStatus].map(({ label, status }) => `**${label}:** ${status}`);
  await interaction.editReply(lines.join('\n'));
}
