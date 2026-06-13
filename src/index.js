require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const memory = require('./memory.js');

const { loadState, state } = require('./autoReply/state');
const { buildIdMap } = require('./utils/idResolver');
const { loadPersonality } = require('./autoReply/personality');
const { handleAutoReply, getRecentBotMessages } = require('./autoReply/engine');
const { resolveContactId } = require('./utils/idResolver');
const { handleCommand } = require('./commands/handler');
const { addLog } = require('./utils/logger');
const { startDashboard, broadcastMessage } = require('./dashboard/server');

// Graceful shutdown
process.on('uncaughtException', async (err) => {
    console.error('Fatal Error (uncaughtException):', err);
    try {
        if (typeof client !== 'undefined' && client) {
            console.error('Destroying WhatsApp client before exit...');
            await client.destroy();
        }
    } catch (e) {
        console.error('Failed to destroy client during shutdown:', e.message);
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// Load external config
loadState();
loadPersonality();

const client = new Client({
    authStrategy: new LocalAuth(),
});

client.on('qr', (qr) => {
    console.log('Please scan the following QR code with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

let isClientReady = false;

client.on('ready', async () => {
    isClientReady = true;
    console.log('Client is ready! The bot is now connected to your WhatsApp.');
    addLog('system', 'WhatsApp client connected and ready.');
    
    try {
        await memory.initDatabase();
        addLog('system', 'MSSQL memory bank connected.');
    } catch (err) {
        console.error('⚠️ Memory DB failed:', err.message);
        addLog('error', `Memory DB failed: ${err.message}`);
    }
    
    await buildIdMap(client);

    // Process missed unread messages for auto-reply
    if (state.autoReplyEnabled) {
        try {
            const chats = await client.getChats();
            let unreadProcessed = 0;
            for (const chat of chats) {
                if (chat.unreadCount > 0) {
                    // Check direct match first to save fetching if possible
                    let shouldProcess = state.autoReplyContacts[chat.id._serialized] || (state.idMap && state.autoReplyContacts[state.idMap[chat.id._serialized]]);
                    
                    const msgs = await chat.fetchMessages({ limit: chat.unreadCount });
                    
                    for (const msg of msgs) {
                        if (!msg.fromMe && !msg.body.startsWith('!')) {
                            // If we didn't match via direct ID, try resolving the ID from the message
                            if (!shouldProcess) {
                                const resolvedId = await resolveContactId(client, msg.from, msg);
                                if (state.autoReplyContacts[resolvedId]) {
                                    shouldProcess = true;
                                }
                            }
                            
                            if (shouldProcess) {
                                await handleAutoReply(client, msg);
                                unreadProcessed++;
                            }
                        }
                    }
                }
            }
            if (unreadProcessed > 0) {
                console.log(`[SYSTEM] Processed ${unreadProcessed} old unread messages for auto-reply.`);
                addLog('system', `Processed ${unreadProcessed} unread messages on startup.`);
            }
        } catch (e) {
            console.error('Failed to process unread messages on startup:', e);
        }
    }
});

const botStartTime = Math.floor(Date.now() / 1000);

client.on('message_create', async (msg) => {
    console.log(`[DEBUG] Received message: "${msg.body}" from ${msg.from} to ${msg.to} (fromMe: ${msg.fromMe})`);
    
    if (msg.timestamp && msg.timestamp < botStartTime) {
        return;
    }
    
    const text = (msg.body || '').toLowerCase();

    if (text.startsWith('!')) {
        const command = text.split(' ')[0];
        const args = (msg.body || '').split(' ').slice(1);
        const argumentsText = args.join(' ');

        await handleCommand(client, msg, command, argumentsText);
    } else {
        // Broadcast received message to dashboard
        try {
            const chat = await msg.getChat();
            const contactName = chat.name || msg.from.split('@')[0];
            broadcastMessage('new_message', {
                id: msg.id._serialized,
                chatId: msg.from,
                name: contactName,
                message: msg.body || `[${msg.type}]`,
                fromMe: false,
                timestamp: Date.now()
            });
        } catch (e) {}

        await handleAutoReply(client, msg);
    }
});

// Capture outgoing manual replies for memory
client.on('message_create', async msg => {
    if (msg.fromMe && !msg.body.startsWith('!') && msg.body.trim().length > 0 && !msg.to.includes('status@broadcast')) {
        // Broadcast sent message to dashboard
        try {
            const chat = await msg.getChat();
            const contactName = chat.name || msg.to.split('@')[0];
            let aiSource = null;
            if (global.aiSourcesByBody && global.aiSourcesByBody.has(msg.body.trim())) {
                aiSource = global.aiSourcesByBody.get(msg.body.trim());
            }

            broadcastMessage('new_message', {
                id: msg.id._serialized,
                chatId: msg.to,
                name: contactName,
                message: msg.body || `[${msg.type}]`,
                fromMe: true,
                timestamp: Date.now(),
                aiSource: aiSource
            });
        } catch (e) {}

        if (getRecentBotMessages().has(msg.body.trim())) return;
        try {
            const chatId = msg.to;
            await memory.saveMessage(chatId, msg.from, 'Me', msg.body, true);
        } catch (e) { /* silent */ }
    }
});

client.initialize();
startDashboard(client, getRecentBotMessages);
