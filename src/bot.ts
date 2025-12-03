import { Client, GatewayIntentBits, Collection, Interaction, REST, Routes } from 'discord.js';
import * as path from 'path';
import * as fs from 'fs';
import './utils/env';
import { auctionService } from './services/AuctionService';

// Define a type for our commands
interface Command {
    data: any; // SlashCommandBuilder
    execute: (interaction: Interaction) => Promise<void>;
}

// Extend Client class to include a commands property
class BotClient extends Client {
    commands: Collection<string, Command> = new Collection();
}

const client = new BotClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
    ],
});

// Load command files
const loadCommands = async () => {
    const commandData: any[] = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = await import(filePath);
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commandData.push(command.data.toJSON());
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
    return commandData;
};

const registerSlashCommands = async (commandsJson: any[]) => {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
        console.warn('Skipping slash command registration. Missing DISCORD_TOKEN or CLIENT_ID in environment.');
        return;
    }

    if (commandsJson.length === 0) {
        console.warn('No commands discovered to register.');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commandsJson },
            );
            console.log(`Registered ${commandsJson.length} guild commands for guild ${process.env.GUILD_ID}.`);
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commandsJson },
            );
            console.log(`Registered ${commandsJson.length} global commands.`);
        }
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
};

client.once('ready', () => {
    console.log(`Ready! Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

(async () => {
    const commandsJson = await loadCommands();
    await registerSlashCommands(commandsJson);
    const finalizerInterval = Number(process.env.AUCTION_FINALIZER_INTERVAL_MS ?? '15000');
    auctionService.startFinalizer(finalizerInterval);
    await client.login(process.env.DISCORD_TOKEN);
})();
