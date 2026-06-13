const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const memory = require('../memory');
const { state, saveToggleState } = require('../autoReply/state');
const { addLog, getLogs, getMessagesSent, getTokensUsed, addTokensUsed, incrementMessagesSent } = require('../utils/logger');
const { getPersonalityPrompt } = require('../autoReply/personality');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch') || global.fetch;
const { generateAIResponse } = require('../utils/llm');

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3000;

let wss;

function startDashboard(client, getRecentBotMessages) {
    const app = express();
    const server = http.createServer(app);
    wss = new WebSocket.Server({ server, path: '/ws' });
    
    wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
    });

    const dashPassword = process.env.DASHBOARD_PASSWORD;
    
    if (!dashPassword) {
        console.error('🔴 FATAL: DASHBOARD_PASSWORD is not set in .env!');
        console.error('   The dashboard exposes sensitive controls — it will not start without a password.');
        console.error('   Add DASHBOARD_PASSWORD=<your_password> to your .env file.');
    }
    
    app.use(basicAuth({
        users: { 'admin': dashPassword || 'INSECURE_DISABLED' },
        challenge: true,
        realm: 'WhatsApp Bot Dashboard'
    }));

    app.use(express.json());

    // Disable caching for development
    app.use((req, res, next) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        next();
    });

    app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    let cachedStats = null;
    let cachedStatsTime = 0;

    app.get('/api/status', async (req, res) => {
        if (!cachedStats || (Date.now() - cachedStatsTime > 30000)) {
            cachedStats = await memory.getGlobalStats();
            cachedStatsTime = Date.now();
        }
        
        res.json({
            connected: true, // simplified
            autoReplyEnabled: state.autoReplyEnabled,
            messagesSentToday: getMessagesSent(),
            totalTokensUsed: getTokensUsed(),
            memory: {
                totalMessages: cachedStats.totalMessages || 0,
                totalAutoReplies: cachedStats.totalAutoReplies || 0,
                totalTokens: cachedStats.totalTokens || 0,
                activeChats: cachedStats.activeChats || 0
            }
        });
    });

    app.get('/api/stats/daily', async (req, res) => {
        try {
            const stats = await memory.getDailyStats(7);
            res.json(stats);
        } catch (e) {
            res.json([]);
        }
    });

    app.get('/api/personality', (req, res) => {
        res.json({ prompt: getPersonalityPrompt() });
    });

    app.post('/api/personality', (req, res) => {
        const { prompt } = req.body;
        if (prompt && typeof prompt === 'string') {
            const { setPersonalityProfile } = require('../autoReply/personality');
            setPersonalityProfile(prompt);
            addLog('config', 'Personality profile updated via dashboard');
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Invalid prompt' });
        }
    });

    let cachedContacts = null;
    let cachedContactsTime = 0;
    let cachedGroups = null;
    let cachedGroupsTime = 0;

    app.get('/api/contacts', async (req, res) => {
        try {
            if (!client || !client.info) return res.json([]);
            if (cachedContacts && (Date.now() - cachedContactsTime < 60000)) {
                const updated = cachedContacts.map(c => ({ ...c, autoReply: state.autoReplyContacts[c.id] === true }));
                return res.json(updated);
            }

            const contacts = await client.getContacts();
            const seen = new Set();
            cachedContacts = contacts
                .filter(c => {
                    if (!c.id || !c.isMyContact) return false;
                    if (c.id.server !== 'c.us') return false;
                    if (!c.name && !c.pushname) return false;
                    const num = c.id.user;
                    if (seen.has(num)) return false;
                    seen.add(num);
                    return true;
                })
                .map(c => ({
                    id: c.id._serialized,
                    name: c.name || c.pushname || 'Unknown',
                    number: c.id.user,
                    autoReply: state.autoReplyContacts[c.id._serialized] === true
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
                
            cachedContactsTime = Date.now();
            res.json(cachedContacts);
        } catch (err) {
            console.error('Error fetching contacts:', err);
            if (cachedContacts) {
                const updated = cachedContacts.map(c => ({ ...c, autoReply: state.autoReplyContacts[c.id] === true }));
                return res.json(updated);
            }
            res.json([]);
        }
    });

    app.get('/api/groups', async (req, res) => {
        try {
            if (!client || !client.info) return res.json([]);
            if (cachedGroups && (Date.now() - cachedGroupsTime < 60000)) {
                const updated = cachedGroups.map(c => ({ ...c, autoReply: state.autoReplyContacts[c.id] === true }));
                return res.json(updated);
            }

            const chats = await client.getChats();
            cachedGroups = chats
                .filter(c => c.isGroup)
                .map(c => ({
                    id: c.id._serialized,
                    name: c.name || 'Unknown Group',
                    participants: c.participants ? c.participants.length : 0,
                    autoReply: state.autoReplyContacts[c.id._serialized] === true
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
                
            cachedGroupsTime = Date.now();
            res.json(cachedGroups);
        } catch (err) {
            console.error('Error fetching groups:', err);
            if (cachedGroups) {
                const updated = cachedGroups.map(c => ({ ...c, autoReply: state.autoReplyContacts[c.id] === true }));
                return res.json(updated);
            }
            res.json([]);
        }
    });

    app.post('/api/auto-reply/toggle', async (req, res) => {
        const { contactId, enabled } = req.body;
        
        // If turning OFF and it was ON
        if (!enabled && state.autoReplyContacts[contactId] !== false) {
            try {
                const offMsg = "🤖 *Bot Offline*\nUn humano ha tomado el control del chat y responderá en breve.";
                await client.sendMessage(contactId, offMsg);
            } catch (e) {
                console.error("Failed to send offline message", e);
            }
        }

        state.autoReplyContacts[contactId] = enabled;
        addLog('config', `Auto-reply ${enabled ? 'enabled' : 'disabled'} for ${contactId}`);
        
        const mapped = state.idMap[contactId];
        if (mapped) {
            state.autoReplyContacts[mapped] = enabled;
            addLog('config', `Auto-reply ${enabled ? 'enabled' : 'disabled'} for mapped ${mapped}`);
        }
        saveToggleState();
        res.json({ success: true });
    });

    app.post('/api/auto-reply/master', async (req, res) => {
        const { enabled } = req.body;
        
        if (!enabled && state.autoReplyEnabled) {
            try {
                const aiMessages = await memory.getActiveAiChats(200);
                const thirtyMinsAgo = Date.now() - (30 * 60 * 1000);
                
                const activeIds = new Set();
                const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
                for (const msg of aiMessages) {
                    const realTime = msg.created_at.getTime() + tzOffset;
                    if (realTime > thirtyMinsAgo && state.autoReplyContacts[msg.chat_id] !== false && !msg.chat_id.includes('status@broadcast')) {
                        activeIds.add(msg.chat_id);
                    }
                }
                
                const offMsg = "🤖 *Bot Offline*\nUn humano ha tomado el control general del chat y responderá en breve.";
                for (const id of activeIds) {
                    try {
                        await client.sendMessage(id, offMsg);
                        console.log(`Successfully sent offline msg to ${id}`);
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (e) {
                        console.error(`Failed to send offline msg to ${id}:`, e.message);
                    }
                }
                if (activeIds.size > 0) {
                    addLog('system', `Broadcasted 'Bot Offline' to ${activeIds.size} active chats`);
                }
            } catch (err) {
                console.error("Failed to broadcast master offline message", err);
            }
        }

        state.autoReplyEnabled = enabled;
        addLog('config', `Master auto-reply ${enabled ? 'ON' : 'OFF'}`);
        saveToggleState();
        res.json({ success: true, autoReplyEnabled: state.autoReplyEnabled });
    });

    app.post('/api/batch-message', async (req, res) => {
        const { contactIds, message } = req.body;
        if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0 || !message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Invalid contactIds or message' });
        }
        if (contactIds.length > 500) return res.status(400).json({ error: 'Max 500 contacts per batch' });
        if (message.length > 2000) return res.status(400).json({ error: 'Message too long' });
        
        addLog('batch', `Starting batch message to ${contactIds.length} contacts`);
        let sent = 0;
        let failed = 0;
        
        for (const contactId of contactIds) {
            try {
                let personalizedMessage = message;
                if (message.includes('{name}')) {
                    let contactName = '';
                    try {
                        const contact = await client.getContactById(contactId);
                        contactName = contact.name || contact.pushname || '';
                    } catch(e) {}
                    
                    if (contactName) {
                        personalizedMessage = message.replace(/{name}/g, contactName);
                    } else {
                        personalizedMessage = message.replace(/{name}/g, '');
                    }
                }

                getRecentBotMessages().add(personalizedMessage);
                setTimeout(() => getRecentBotMessages().delete(personalizedMessage), 10000);
                await client.sendMessage(contactId, personalizedMessage);
                sent++;
                incrementMessagesSent();
            } catch (err) {
                failed++;
                console.error(`Failed to send to ${contactId}:`, err.message);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        
        addLog('batch', `Batch complete. Sent: ${sent}, Failed: ${failed}`);
        res.json({ success: true, sent, failed });
    });

    app.post('/api/proactive-start', async (req, res) => {
        const { contactId } = req.body;
        if (!contactId) return res.status(400).json({ error: 'Missing contactId' });
        
        try {
            let contactName = contactId.split('@')[0];
            try {
                const contact = await client.getContactById(contactId);
                contactName = contact.name || contact.pushname || contact.number;
            } catch(e) {}
            
            addLog('system', `Generating proactive AI message for ${contactName}`);
            
            const history = await memory.getConversationHistory(contactId, 100);
            let contextText = '';
            if (history && history.length > 0) {
                contextText = history.reverse().map(msg => 
                    `${msg.is_from_me ? 'Me' : 'Them'}: ${msg.message}`
                ).join('\n');
            } else {
                contextText = "No previous conversation history.";
            }

            const prompt = `Contact Name: ${contactName}\n${getPersonalityPrompt()}\n        
Here is the recent conversation history with this person:
${contextText}

CRITICAL SYSTEM INSTRUCTION:
1. DETECT THE LANGUAGE of the recent conversation history above.
2. You MUST write your proactive opening message entirely in THAT EXACT SAME LANGUAGE.
3. If the history is in Spanish, write 100% in Spanish. If English, 100% English.
4. If there is no history, use Spanish by default.
5. ANALYZE THE CONTACT: If the contact name (${contactName}) or history looks like a business, university (e.g., UNITEC), or formal entity, YOU MUST ACT PROFESSIONALLY AND POLITELY. Do NOT act like a boyfriend/girlfriend. If it's a personal friend/partner, act casually based on the personality profile.
6. Generate ONE short, natural opening message to start a conversation. Base it on the last topic if applicable, or just say a friendly hello.
7. Keep it MAX 1 short sentence. Very brief.
8. NO EMOJIS WHATSOEVER. Zero emojis.
9. NO quotes around your text.

Generate ONLY the text of your message now:`;

            const aiRes = await generateAIResponse(prompt, getPersonalityPrompt());
            let aiMessage = aiRes.reply;
            addTokensUsed(aiRes.tokens);
            
            aiMessage = aiMessage.replace(/^"|"$/g, '').trim();
            addLog('config', `AI Start draft for ${contactName}: "${aiMessage}" (${aiRes.source})`);
            
            res.json({ success: true, message: aiMessage, contactName, source: aiRes.source });
        } catch (err) {
            console.error('Proactive start error:', err);
            addLog('error', `Proactive AI failed: ${err.message}`);
            res.status(500).json({ error: 'Failed to generate and send proactive message.' });
        }
    });

    app.get('/api/active-chats', async (req, res) => {
        try {
            const aiMessages = await memory.getActiveAiChats(200);
            
            const chatsMap = {};
            for (const msg of aiMessages) {
                if (!chatsMap[msg.chat_id]) {
                    chatsMap[msg.chat_id] = {
                        id: msg.chat_id,
                        name: msg.sender_name || msg.chat_id.split('@')[0],
                        messageCount: 0,
                        aiReplies: 0,
                        lastActivity: msg.created_at,
                        botEnabled: state.autoReplyContacts[msg.chat_id] !== false,
                        recentMessages: []
                    };
                }
                chatsMap[msg.chat_id].aiReplies++;
                chatsMap[msg.chat_id].messageCount++;
                if (chatsMap[msg.chat_id].recentMessages.length < 5) {
                    chatsMap[msg.chat_id].recentMessages.push({
                        message: msg.message,
                        isFromMe: msg.is_from_me,
                        isAutoReply: msg.is_auto_reply,
                        timestamp: msg.created_at,
                        tokens: msg.tokens_used || 0
                    });
                }
            }
            
            const chats = Object.values(chatsMap);
            chats.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
            res.json(chats);
        } catch (err) {
            console.error('Active chats error:', err);
            res.json([]);
        }
    });

    app.get('/api/logs', (req, res) => {
        res.json(getLogs());
    });

    app.get('/api/memory/conversations', async (req, res) => {
        try {
            const conversations = await memory.getRecentConversations(100);
            res.json(conversations);
        } catch (err) {
            res.json([]);
        }
    });

    app.get('/api/memory/chat/:chatId', async (req, res) => {
        try {
            const history = await memory.getConversationHistory(decodeURIComponent(req.params.chatId), 50);
            res.json(history);
        } catch (err) {
            res.json([]);
        }
    });

    app.get('/api/inbox', async (req, res) => {
        try {
            if (!client || !client.info) return res.json({ unread: [], unanswered: [] });
            const chats = await client.getChats();
            const unread = [];
            const unanswered = [];
            
            for (const chat of chats) {
                if (chat.id._serialized.includes('status@broadcast')) continue;
                
                let contactName = chat.name || chat.id.user || 'Unknown';
                
                let lastMessages = [];
                try {
                    const msgs = await chat.fetchMessages({ limit: 5 });
                    lastMessages = msgs.map(m => ({
                        body: m.body || (m.type === 'sticker' ? '[Sticker]' : `[${m.type}]`),
                        fromMe: m.fromMe,
                        timestamp: m.timestamp * 1000,
                        type: m.type
                    }));
                } catch (e) {}
                
                const lastMsg = lastMessages.length > 0 ? lastMessages[lastMessages.length - 1] : null;
                
                const chatInfo = {
                    id: chat.id._serialized,
                    name: contactName,
                    isGroup: chat.isGroup,
                    lastMessage: lastMsg ? lastMsg.body : '',
                    lastMessageTime: lastMsg ? lastMsg.timestamp : 0,
                    lastMessageFromMe: lastMsg ? lastMsg.fromMe : false,
                    unreadCount: chat.unreadCount || 0,
                    botEnabled: state.autoReplyContacts[chat.id._serialized] !== false
                };
                
                if (chat.unreadCount > 0) {
                    unread.push(chatInfo);
                }
                
                if (!chat.isGroup && lastMsg && !lastMsg.fromMe && lastMsg.timestamp > (Date.now() - 24 * 60 * 60 * 1000)) {
                    unanswered.push(chatInfo);
                }
            }
            
            unread.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
            unanswered.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
            
            res.json({ unread, unanswered });
        } catch (err) {
            console.error('Error fetching inbox:', err);
            res.json({ unread: [], unanswered: [] });
        }
    });

    app.post('/api/reply', async (req, res) => {
        const { chatId, message } = req.body;
        if (!chatId || !message || typeof message !== 'string') return res.status(400).json({ error: 'Missing chatId or message' });
        if (message.length > 4000) return res.status(400).json({ error: 'Message too long' });
        
        try {
            let contactName = chatId.split('@')[0];
            try {
                const contact = await client.getContactById(chatId);
                contactName = contact.name || contact.pushname || contactName;
            } catch(e) {}

            const lines = message.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const trimmedLine = line.trim();
                getRecentBotMessages().add(trimmedLine);
                setTimeout(() => getRecentBotMessages().delete(trimmedLine), 10000);
                await client.sendMessage(chatId, trimmedLine);
                await memory.saveMessage(chatId, 'bot', contactName, trimmedLine, true, false, 0);
                incrementMessagesSent();
                if (lines.length > 1) {
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                }
            }
            
            addLog('auto-reply', `Dashboard reply to ${contactName}: "${message.replace(/\n/g, ' ')}"`);
            
            res.json({ success: true });
        } catch (err) {
            console.error('Reply error:', err);
            res.status(500).json({ error: 'Failed to send reply' });
        }
    });

    app.post('/api/reply-ai', async (req, res) => {
        const { chatId } = req.body;
        if (!chatId) return res.status(400).json({ error: 'Missing chatId' });
        
        try {
            let contactName = chatId.split('@')[0];
            try {
                const contact = await client.getContactById(chatId);
                contactName = contact.name || contact.pushname || contactName;
            } catch(e) {}
            
            const history = await memory.getConversationHistory(chatId, 50);
            const contextStr = history.length > 0 
                ? history.map(h => `${h.who}: ${h.msg}`).join('\n')
                : 'No previous conversation.';
            
            let recentMessages = '';
            try {
                const chat = await client.getChatById(chatId);
                const msgs = await chat.fetchMessages({ limit: 10 });
                recentMessages = msgs.map(m => `${m.fromMe ? 'Me' : contactName}: ${m.body || `[${m.type}]`}`).join('\n');
            } catch(e) {}
            
            const prompt = `Contact Name: ${contactName}\n${getPersonalityPrompt()}

Recent conversation from memory:
${contextStr}

Latest messages (most current):
${recentMessages}

CRITICAL SYSTEM INSTRUCTION:
1. DETECT THE LANGUAGE of the latest messages above.
2. You MUST reply in the EXACT SAME LANGUAGE as the user. If they write in Spanish, YOU MUST REPLY 100% IN SPANISH. If English, 100% English.
3. If the message is ambiguous, short, or just an emoji, DEFAULT TO SPANISH. NEVER MIX LANGUAGES.
4. ANALYZE THE CONTACT: If the contact name (${contactName}) or history looks like a business, university (e.g., UNITEC), or formal entity, act professionally. If it looks like a personal contact, act casually based on the personality profile.
5. Keep it natural and engaging. ACTIVELY KEEP THE CONVERSATION FLOWING by asking a natural follow-up question or making a conversational hook to keep them talking.
6. NO EMOJIS WHATSOEVER. Zero emojis.
7. NO quotes around your text.
8. NEVER greet if conversation is ongoing.
9. IF the user sent multiple short messages recently, you should reply with multiple short sentences separated by NEWLINES. Each newline will be sent as a separate chat bubble. Match their rhythm.

Generate ONLY the text of your reply now:`;

            const aiRes = await generateAIResponse(prompt, getPersonalityPrompt());
            let reply = aiRes.reply;
            addTokensUsed(aiRes.tokens);
            
            reply = reply.replace(/^"|"$/g, '').trim();
            
            if (!reply) return res.status(500).json({ error: 'AI generated empty reply' });
            
            addLog('config', `AI draft for ${contactName}: "${reply}" (${aiRes.source})`);
            res.json({ success: true, message: reply, source: aiRes.source });
        } catch (err) {
            console.error('AI reply error:', err);
            res.status(500).json({ error: 'Failed to generate AI reply' });
        }
    });

    if (dashPassword) {
        server.listen(DASHBOARD_PORT, () => {
            console.log(`\n🚀 Dashboard running at: http://localhost:${DASHBOARD_PORT}`);
            addLog('system', `Dashboard server started on port ${DASHBOARD_PORT}`);
        });
    } else {
        console.warn('⚠️  Dashboard is DISABLED — set DASHBOARD_PASSWORD in .env to enable it.');
    }
}

function broadcastMessage(type, payload) {
    if (!wss) return;
    const data = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

module.exports = {
    startDashboard,
    broadcastMessage
};
