const { state } = require('./state');
const { resolveContactId } = require('../utils/idResolver');
const memory = require('../memory');
const { getPersonalityPrompt } = require('./personality');
const { addLog, addTokensUsed, incrementMessagesSent } = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch') || global.fetch;
const { generateAIResponse } = require('../utils/llm');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const messageQueues = {};  // { chatId: { messages: [], timer: null, isProcessing: false } }
const recentBotMessages = new Set(); // Need to export/share this if used elsewhere, but for now we'll keep it here

async function handleAutoReply(client, msg) {
    if (!state.autoReplyEnabled || msg.fromMe || msg.from.includes('status@broadcast')) return;

    let messageContent = msg.body ? msg.body.trim() : '';
    let imageBase64 = null;
    let imageMimeType = null;

    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.mimetype.startsWith('image/')) {
                messageContent += `\n[Image attached]`;
                imageBase64 = media.data; // Base64 string from whatsapp-web.js
                imageMimeType = media.mimetype;
            } else if (media) {
                messageContent += `\n[${msg.type} attached]`;
            } else {
                messageContent += `\n[${msg.type} received but unavailable]`;
            }
        } catch (e) {
            console.error('Failed to download media for auto-reply', e);
            messageContent += `\n[${msg.type} attached]`;
        }
    } else if (messageContent === '') {
        if (msg.type === 'sticker') messageContent = '[Sticker sent]';
        else if (['video', 'audio', 'ptt', 'voice'].includes(msg.type)) {
            messageContent = `[${msg.type} sent]`;
        }
    }
    
    if (!messageContent) return;

    const resolvedId = await resolveContactId(client, msg.from, msg);
    const contactAutoReply = state.autoReplyContacts[resolvedId];
    console.log(`[AUTO-REPLY CHECK] from=${msg.from} -> resolved=${resolvedId} -> enabled=${contactAutoReply}`);
    if (contactAutoReply !== true) return;
    
    const contact = await msg.getContact();
    const senderName = contact?.pushname || contact?.name || msg.from.split('@')[0];
    await memory.saveMessage(msg.from, msg.from, senderName, messageContent, false);
    
    if (!messageQueues[msg.from]) {
        messageQueues[msg.from] = { messages: [], timer: null, isProcessing: false };
    }
    const queue = messageQueues[msg.from];
    queue.messages.push(messageContent);
    
    if (queue.isProcessing) return;
    
    if (queue.timer) clearTimeout(queue.timer);
    
    const processQueue = async () => {
        queue.isProcessing = true;
        const allMessages = queue.messages.join(' | ');
        const hasImage = !!imageBase64; // Check if we collected an image
        queue.messages = [];
        queue.timer = null;
        
        try {
            console.log(`\n🤖 Auto-replying to: "${allMessages}"`);
            
            const chat = await msg.getChat();
            chat.sendStateTyping();
            
            // Get last 10 messages directly from WhatsApp for perfect context
            let recentWhatsAppMsgs = [];
            try {
                const msgs = await chat.fetchMessages({ limit: 10 });
                recentWhatsAppMsgs = msgs.map(m => {
                    const sender = m.fromMe ? 'Me' : senderName;
                    return `${sender}: ${m.body || '[Media]'}`;
                });
            } catch(e) {}

            const history = await memory.getConversationHistory(msg.from, 50);
            let combinedContext = '';
            if (recentWhatsAppMsgs.length > 0) {
                combinedContext = recentWhatsAppMsgs.join('\n');
            } else if (history.length > 0) {
                combinedContext = history.map(h => `${h.who}: ${h.msg}`).join('\n');
            }

            const contextStr = combinedContext ? '\n\nRecent conversation:\n' + combinedContext : '';
            
            const typingDelay = Math.min(3000 + (allMessages.length * 80), 8000) + Math.random() * 3000;
            console.log(`  ⌛ Waiting ${Math.round(typingDelay/1000)}s to feel natural...`);
            
            let reply = '';
            
            const currentTime = new Date().toLocaleString();
            let promptText = `Contact Name: ${senderName}\nCurrent Local Time: ${currentTime}\n${contextStr}\n\nNew message(s): "${allMessages}"\n\nCRITICAL SYSTEM INSTRUCTION:\n1. DETECT THE LANGUAGE of the "New message(s)" above.\n2. You MUST reply in the EXACT SAME LANGUAGE as the user. If they write in Spanish, YOU MUST REPLY 100% IN SPANISH. If English, 100% English.\n3. If the message is ambiguous, short, or just an emoji, DEFAULT TO SPANISH. NEVER MIX LANGUAGES.\n4. ANALYZE THE CONTACT: If the contact name (${senderName}) or history looks like a business, university (e.g., UNITEC), or formal entity, act professionally. If it looks like a personal contact, act casually based on the personality profile.\n5. USE THE CURRENT TIME: It is currently ${currentTime}. If appropriate, naturally incorporate time-aware greetings (e.g. good morning, buenas noches).\n6. Keep it natural and engaging. ACTIVELY KEEP THE CONVERSATION FLOWING by asking a natural follow-up question or making a conversational hook to keep them talking.\n7. NO EMOJIS WHATSOEVER. Zero emojis.\n8. NO quotes around your text.\n9. NEVER greet if conversation is ongoing. NEVER say "my friend".\n10. IF the user sent multiple short messages recently, you should reply with multiple short sentences separated by NEWLINES. Each newline will be sent as a separate chat bubble. Match their rhythm.\n\nGenerate ONLY the text of your reply now:`;

            const aiRes = await generateAIResponse(promptText, getPersonalityPrompt(), imageBase64, imageMimeType);
            reply = aiRes.reply;
            const totalTkns = aiRes.tokens;
            
            addTokensUsed(totalTkns);
            console.log(`  🏠 Used ${aiRes.source} (${totalTkns} tokens)`);
            
            reply = reply.replace(/^"|"$/g, '').trim();
            
            if (!reply) {
                reply = "What's up? I didn't quite catch that.";
            }
            
            await new Promise(r => setTimeout(r, typingDelay));
            
            const chatId = msg.from;
            
            if (!global.aiSourcesByBody) global.aiSourcesByBody = new Map();

            const lines = reply.split('\n').filter(l => l.trim());
            if (lines.length > 1 && lines.length <= 3) {
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    recentBotMessages.add(trimmedLine);
                    global.aiSourcesByBody.set(trimmedLine, aiRes.source);
                    setTimeout(() => recentBotMessages.delete(trimmedLine), 10000);
                    setTimeout(() => global.aiSourcesByBody.delete(trimmedLine), 10000);
                    await client.sendMessage(chatId, trimmedLine);
                    await new Promise(r => setTimeout(r, 1500));
                }
            } else {
                recentBotMessages.add(reply);
                global.aiSourcesByBody.set(reply, aiRes.source);
                setTimeout(() => recentBotMessages.delete(reply), 10000);
                setTimeout(() => global.aiSourcesByBody.delete(reply), 10000);
                await client.sendMessage(chatId, reply);
            }
            
            await memory.saveMessage(chatId, 'bot', 'Me', reply, true, true, totalTkns);
            
            incrementMessagesSent();
            addLog('auto-reply', `Replied to ${senderName}: "${reply}"`);
        } catch (error) {
            console.error('Auto-reply error:', error.message);
            addLog('error', `Auto-reply to ${senderName} failed: ${error.message}`);
        } finally {
            queue.isProcessing = false;
            if (queue.messages.length > 0) {
                queue.timer = setTimeout(processQueue, 3000);
            }
        }
    };
    queue.timer = setTimeout(processQueue, 4000);
}

function getRecentBotMessages() {
    return recentBotMessages;
}

module.exports = {
    handleAutoReply,
    getRecentBotMessages
};
