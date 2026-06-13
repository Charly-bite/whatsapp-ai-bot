const { state, saveIdMap, saveToggleState } = require('../autoReply/state');

async function resolveContactId(client, senderId, msg) {
    // Direct match
    if (state.autoReplyContacts[senderId] !== undefined) return senderId;
    // Static map match
    const mapped = state.idMap[senderId];
    if (mapped && state.autoReplyContacts[mapped] !== undefined) return mapped;
    
    // Fallback 1: Build c.us ID from the phone number
    if (senderId.includes('@lid') && msg) {
        try {
            const contact = await msg.getContact();
            if (contact) {
                // Try to build c.us ID from number
                if (contact.number) {
                    const cusId = contact.number + '@c.us';
                    console.log(`[RESOLVE] lid=${senderId} -> number=${contact.number}`);
                    if (state.autoReplyContacts[cusId] !== undefined) {
                        state.idMap[senderId] = cusId;
                        state.idMap[cusId] = senderId;
                        saveIdMap();
                        return cusId;
                    }
                }
                // Fallback 2: Map by Name (if the dashboard toggle uses c.us but contact.number was the LID)
                const name = contact.name || contact.pushname;
                let chatName = null;
                try {
                    const chat = await msg.getChat();
                    chatName = chat.name;
                } catch(e) {}
                
                if (name || chatName) {
                    const allContacts = await client.getContacts();
                    const match = allContacts.find(c => {
                        if (!c.id || !c.id._serialized.includes('@c.us')) return false;
                        const cName = c.name || '';
                        const cPush = c.pushname || '';
                        
                        if (name && (cName === name || cPush === name)) return true;
                        if (chatName && (cName === chatName || cPush === chatName)) return true;
                        
                        // Strict word match instead of raw substring to prevent "Alo" matching "Alondra"
                        if (name && cName && new RegExp(`\\b${name}\\b`, 'i').test(cName)) return true;
                        if (name && cPush && new RegExp(`\\b${name}\\b`, 'i').test(cPush)) return true;
                        
                        return false;
                    });
                    if (match && match.id) {
                        const cusId = match.id._serialized;
                        console.log(`[RESOLVE] lid=${senderId} matched by NAME "${name || chatName}" -> ${cusId}`);
                        state.idMap[senderId] = cusId;
                        state.idMap[cusId] = senderId;
                        saveIdMap();
                        return state.autoReplyContacts[cusId] !== undefined ? cusId : senderId;
                    }
                }
            }
        } catch(e) {
            console.log(`[RESOLVE ERR] lid=${senderId} error: ${e.message}`);
        }
    }
    return senderId;
}

async function buildIdMap(client) {
    try {
        const allContacts = await client.getContacts();
        let mapped = 0;
        
        // Collect all contacts grouped by name
        const cusById = {};  // name -> c.us id
        const lidById = {};  // name -> lid id
        
        for (const c of allContacts) {
            if (!c.id || !c.isMyContact) continue;
            const name = c.name || c.pushname;
            if (!name) continue;
            const serialized = c.id._serialized;
            if (serialized.includes('@c.us')) cusById[name] = serialized;
            if (serialized.includes('@lid')) lidById[name] = serialized;
        }
        
        // Cross-reference: for names appearing in both, create mapping
        for (const name in cusById) {
            if (lidById[name]) {
                const cusId = cusById[name];
                const lidId = lidById[name];
                state.idMap[lidId] = cusId;
                state.idMap[cusId] = lidId;
                mapped++;
            }
        }
        if (mapped > 0) saveIdMap();
        
        console.log(`✅ Built ID map: ${mapped} contacts mapped (LID <-> c.us)`);
        
        // Sync autoReplyContacts: for any enabled contact, also enable its mapped alternate
        const toAdd = {};
        for (const [id, enabled] of Object.entries(state.autoReplyContacts)) {
            if (enabled && state.idMap[id] && !state.autoReplyContacts[state.idMap[id]]) {
                toAdd[state.idMap[id]] = true;
            }
        }
        if (Object.keys(toAdd).length > 0) {
            Object.assign(state.autoReplyContacts, toAdd);
            saveToggleState();
            console.log(`✅ Synced ${Object.keys(toAdd).length} mapped IDs to auto-reply state`);
        }
    } catch (err) {
        console.error('⚠️ ID map build failed:', err.message);
    }
}

module.exports = {
    resolveContactId,
    buildIdMap
};
