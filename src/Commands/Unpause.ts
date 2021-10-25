import { CommandInteraction, GuildMember } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { AudioController } from "../voiceHandler";


module.exports = {
    data: new SlashCommandBuilder()
        .setName("unpause")
        .setDescription("Unpause the current song"),
    async execute(interaction:CommandInteraction):Promise<void> {
        AudioController.unpuase(interaction);
    }
}  