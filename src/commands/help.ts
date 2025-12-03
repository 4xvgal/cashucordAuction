import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { getInteractionLanguage, resolveLanguageFromInput, t } from '../utils/i18n';

export const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Shows bot usage information in the selected language.')
    .addStringOption(option =>
        option
            .setName('language')
            .setDescription('Language code (en or ko). Defaults to bot settings.')
            .setRequired(false),
    );

export async function execute(interaction: CommandInteraction) {
    if (!interaction.isChatInputCommand()) return;

    const requestedLang = interaction.options.getString('language');
    const lang = requestedLang
        ? resolveLanguageFromInput(requestedLang)
        : getInteractionLanguage(interaction);

    await interaction.reply({
        content: t('help.content', lang, { lang }),
        ephemeral: true,
    });
}
