import { AudioPlayer, AudioResource, createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnection, AudioPlayerStatus, VoiceConnectionStatus } from "@discordjs/voice";
import { CommandInteraction, GuildManager, GuildMember, Interaction, MessageEmbed } from "discord.js";
import { EventEmitter } from "events";
import { Timeout } from "./Utils/timeout";
import ytsr from "ytsr";
import { url } from "inspector";
import ytdl from "ytdl-core";
import embeds from "./config/embeds.json";
import { stringify } from "querystring";
import { title } from "process";
import exp from "constants";

export namespace AudioController {
    export const eventEmitter = new EventEmitter();
    let audioPlayer:AudioPlayer;
    let voiceConnection:VoiceConnection;
    var currentInteraction:CommandInteraction;
    const timer = new Timeout(1000, 360);
    let queue:string[] = [];
    let currentChannel:string = " ";

    eventEmitter.on("play", async (interaction:CommandInteraction) => {
        currentInteraction = interaction;
        const tempMember = currentInteraction.member as GuildMember;
        if(tempMember.voice.channelId != null) {
            //Always stop the timer when a new command begins 
            timer.stop();
            //When the bot is started for the first time the voiceConnection state is undefined
            if (voiceConnection != undefined) {
                /*The whole point of this is to stop the bot from restarting it self every time the user enters a song request.
                 *If the bot and the user is in serprate channel, then the bot will switch over to the channel the user is in.
                 *If the user enter to play a song while the bot is still in the same channel then the bot will just add a song to the queue
                 *If the bot is destoyed then it will be able to join the same channel as before
                 */ 
                if (voiceConnection.state.status == "destroyed" || tempMember.voice.channel.id != currentChannel) {
                    await createPlayer(tempMember, currentInteraction);
                    console.log("Created a new player");
                }

            }
            else {
                await createPlayer(tempMember, currentInteraction);
                console.log("Created a new player");
            }
            
            await checkVaildURL(currentInteraction.options.getString("song"), currentInteraction).then( () => {
                playSong(currentInteraction);
            } );

            audioPlayer.removeAllListeners(AudioPlayerStatus.Idle);
            audioPlayer.on(AudioPlayerStatus.Idle, () => {
                playSong(currentInteraction);
            });
            
            audioPlayer.removeAllListeners('error');
            audioPlayer.on('error', error => {
                console.error(error);
            });

            voiceConnection.removeAllListeners(VoiceConnectionStatus.Disconnected);
            voiceConnection.on(VoiceConnectionStatus.Disconnected, () => {
                audioPlayer.stop();
                voiceConnection.destroy();
                clearOutQueue();
            });

        }
        else {
            currentInteraction.reply({content:"You must join a voice channel to summon the bot", ephemeral:true});
        }
    });

    eventEmitter.on("stop", (interaction:CommandInteraction) => {
        currentInteraction = interaction;
        const tempMember = currentInteraction.member as GuildMember;
        if(tempMember.voice.channelId != null) {
            if(voiceConnection.joinConfig.channelId == tempMember.voice.channel.id) {
                if(timer.timerStatus || audioPlayer.state.status == "playing") {
                    console.log(audioPlayer.state, voiceConnection.state);
                    voiceConnection.destroy();
                    console.log(audioPlayer.state, voiceConnection.state);
                    clearOutQueue();
                    timer.stop();
                    currentInteraction.reply("The bot has left the voice channel");
                }
                else {
                    currentInteraction.reply("The bot is not in channel");
                }
            }
            else {
                currentInteraction.reply({content:"You must join the same voice channel to stop the bot", ephemeral:true});
            }
        }
        else {
            currentInteraction.reply({content:"You must join the same voice channel to stop the bot", ephemeral:true});
        }
    })

    //Check if the request the user placed is a url or a search title
    async function checkVaildURL(url:string, interaction:CommandInteraction):Promise<void> {
        if(!interaction.deferred && !interaction.replied) await interaction.deferReply();
        if (url.search(/http[s]{0,}:\/\/www.youtube.com\/watch/g) != -1) {
            await addToQueue(url, interaction);
        }
        else {
            await searchForVideo(url, interaction);
        }
    }

    async function searchForVideo(request:string, interaction:CommandInteraction):Promise<void> {
        const searchResult:ytsr.Item = await ytsr(request).then((result) => {
            return result.items[0];  
        } );
        console.log(searchResult);
        await addToQueue(searchResult["url"], interaction);
    }

    async function addToQueue(item:string, interaction:CommandInteraction):Promise<void> {
        const addedQueue:object = embeds.addedQueue;
        const title = (await ytdl.getInfo(item)).videoDetails.title;
        addedQueue["title"] = "Added " + title + " to the queue";
        
        queue.push(item);
        interaction.editReply({embeds: [addedQueue]});
    }
    
    async function createPlayer(tempMember:GuildMember, interaction:CommandInteraction):Promise<void> {
        voiceConnection = joinVoiceChannel( {
            channelId: tempMember.voice.channel.id,
            guildId: tempMember.voice.channel.guild.id,
            selfDeaf: true,
            adapterCreator: tempMember.voice.channel.guild.voiceAdapterCreator
        })
        
        await interaction.reply("Joined the " + tempMember.voice.channel.name + " channel");
        audioPlayer = createAudioPlayer();
        currentChannel = tempMember.voice.channel.id;
        voiceConnection.subscribe(audioPlayer);
    }
    
    async function playSong(interaction:CommandInteraction):Promise<void> {
        console.log(audioPlayer.state.status);
        if (audioPlayer.state.status == AudioPlayerStatus.Idle) {
            const nextSong = queue.shift()
            if (nextSong != undefined) {
                const audioResource:AudioResource = (nextSong != undefined) ? createAudioResource(await ytdl(nextSong, {filter: format => format.audioQuality == "AUDIO_QUALITY_MEDIUM" })) : null;
                const nowPlayingEmbed: Object = embeds.musicPlayer;
                const title:string = (await ytdl.getInfo(nextSong)).videoDetails.title;
                nowPlayingEmbed["title"] = "Playing: " + title; 
                
                console.log(interaction.replied, interaction.deferred);
                //Prints out to the user the currently playing song. The interaction can be in different state hence the if statement
                if (interaction.deferred) {
                    console.log("Edited reply");
                    interaction.editReply({embeds: [nowPlayingEmbed]});
                }
                else if (interaction.replied && !interaction.deferred) {
                    console.log("Followed up to reply");
                    interaction.followUp({embeds: [nowPlayingEmbed]});
                }
                else {
                    console.log("Replied");
                    interaction.reply({embeds: [nowPlayingEmbed]});
                }

                console.log(audioResource);
                audioPlayer.play(audioResource);
                //This line should stop the bot from going to idle state immediately which stops the bot from skipping the next song 
                setTimeout(() => console.log("Finished song"), audioResource.playbackDuration);
                
                //This might fix that bug where the audio player aborts randomly
                audioPlayer.on('error', error => {
                    console.log(`Error: ${error.message} with resource ${error.resource.metadata}`);
                    audioPlayer.play(audioResource);
                });

            }
            else {
                //Removes all the listeners to prevent a memory leak
                timer.eventEmitter.removeAllListeners("finished");
                timer.start();
                timer.eventEmitter.on("finished", () => {
                    audioPlayer.stop();
                    voiceConnection.destroy();
                });
            }
        }
    }
    
    export async function readOutQueue(interaction:CommandInteraction):Promise<void> {
        currentInteraction = interaction;
        currentInteraction.deferReply();
        console.log(queue);
        if (queue.length > 0) {
            let queueEmbed:MessageEmbed = new MessageEmbed()
                .setTitle(embeds.queue.title)
                .setColor([embeds.queue.color[0],embeds.queue.color[1],embeds.queue.color[2]]);
            //Only want the first ten item from the queue
            const maxSize = (queue.length < 10) ? queue.length : 10;
            let description:string = "";

            for (let index = 0; index < maxSize; index++) {
                const element:string = queue[index];
                const info = await ytdl.getInfo(await ytdl.getURLVideoID(element));
                const title:string = info.videoDetails.title;
                description +=  (index+1) + ": " + title + "\n";
            }
            if (queue.length > 10) {
                description += "There are currently " + (queue.length - 10) + " addtional songs in the queue\n";
            }
            queueEmbed.setDescription(description);
            currentInteraction.followUp({embeds: [queueEmbed]});
        }
        else {
            currentInteraction.followUp("There are currently no song in the queue");
        }
    }

    export function clearOutQueue():void {
        queue = [];
    }

    export function skipSong(interaction:CommandInteraction) {
        currentInteraction = interaction;
        if (audioPlayer.state.status != (AudioPlayerStatus.Idle || AudioPlayerStatus.Buffering)) {
            audioPlayer.stop();
        }
        interaction.reply({embeds: [{title:"Skipping the current song" , "color":[29, 166, 229]}]});
    }

    export function pause(interaction:CommandInteraction):void {
        currentInteraction = interaction;
        const tempMember = currentInteraction.member as GuildMember;
        const message:object = embeds.musicPlayer; 
        if (voiceConnection != undefined) {
            if (voiceConnection.state.status != "destroyed" || tempMember.voice.channel.id == currentChannel) {
                audioPlayer.pause();
                message["title"] = "The bot has been puased";
            }
            else {
                message["color"] = embeds.error.color;
                message["title"] = "You must be in the same voice channel to puase the bot";
            }
        }
        else {
            message["color"] = embeds.error.color;
            message["title"] = "The must be playing something to puase the bot";
        }
        currentInteraction.reply({embeds: [message]});
    }

    export function unpuase(interaction:CommandInteraction):void {
        currentInteraction = interaction;
        const tempMember = currentInteraction.member as GuildMember;
        const message:object = embeds.musicPlayer; 
        if (voiceConnection != undefined) {
            if (voiceConnection.state.status != "destroyed" || tempMember.voice.channel.id == currentChannel) {
                audioPlayer.unpause();
                message["title"] = "The bot has been unpuased";
            }
            else {
                message["color"] = embeds.error.color;
                message["title"] = "You must be in the same voice channel to unpuase the bot";
            }
        }
        else {
            message["color"] = embeds.error.color;
            message["title"] = "The bot must be playing something to unpuase the bot";
        }
        currentInteraction.reply({embeds: [message]});
    }

} 