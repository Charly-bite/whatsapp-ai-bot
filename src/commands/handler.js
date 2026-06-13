const handleDownload = require('./download');
const handleRead = require('./read');
const handleChat = require('./chat');
const handleSticker = require('./sticker');
const handleDraw = require('./draw');
const handleSpeak = require('./speak');
const handleWeather = require('./weather');
const handleNews = require('./news');
const handleDefine = require('./define');
const handleSummarize = require('./summarize');
const handleTranslate = require('./translate');
const handleRemind = require('./remind');
const handlePersonality = require('./personality');

async function handleCommand(client, msg, command, argumentsText) {
    switch (command) {
        case '!ping':
            await msg.reply('pong');
            break;
        
        case '!help':
            await msg.reply('Here are the available commands:\n- *!ping* : Test the bot\n- *!download [song/url]* : Download music\n- *!read [book]* : Download a book\n- *!chat [message]* : Chat with AI\n- *!sticker* : Image/video to sticker\n- *!draw* or *!image [prompt]* : Generate AI image\n- *!speak* or *!tts [text]* : Text-to-speech\n- *!weather [city]* : Fetch weather\n- *!news [topic]* : Fetch news\n- *!define [word]* : Dictionary\n- *!summarize* : Reply to a message to summarize\n- *!translate [text] -[lang]* : Translate text\n- *!remind [time] [msg]* : Set reminder\n- *!personality [profile]* : Switch AI personality\n- *!info* : Get contact info');
            break;
            
        case '!info':
            await msg.reply('We are open Monday to Friday, 9am - 5pm. You can reach us at contact@example.com.');
            break;
            
        case '!order':
            if (argumentsText) {
                await msg.reply(`Thank you! Your custom order for *${argumentsText}* has been received and will be processed soon.`);
            } else {
                await msg.reply('Please specify what you want to order! Example: *!order pizza*');
            }
            break;

        case '!download':
            await handleDownload(client, msg, argumentsText);
            break;

        case '!read':
            await handleRead(client, msg, argumentsText);
            break;

        case '!chat':
            await handleChat(client, msg, argumentsText);
            break;

        case '!sticker':
            await handleSticker(client, msg);
            break;

        case '!draw':
        case '!image':
            await handleDraw(client, msg, argumentsText);
            break;

        case '!speak':
        case '!tts':
            await handleSpeak(client, msg, argumentsText);
            break;

        case '!weather':
            await handleWeather(client, msg, argumentsText);
            break;

        case '!news':
            await handleNews(client, msg, argumentsText);
            break;

        case '!define':
            await handleDefine(client, msg, argumentsText);
            break;

        case '!summarize':
            await handleSummarize(client, msg, argumentsText);
            break;

        case '!translate':
            await handleTranslate(client, msg, argumentsText);
            break;

        case '!remind':
            await handleRemind(client, msg, argumentsText);
            break;

        case '!personality':
            await handlePersonality(client, msg, argumentsText);
            break;

        default:
            await msg.reply("Sorry, I don't recognize that command. Type *!help* to see what I can do.");
            break;
    }
}

module.exports = {
    handleCommand
};
