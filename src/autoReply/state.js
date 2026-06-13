const fs = require('fs');
const path = require('path');

const TOGGLE_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'auto_reply_state.json');
const MAP_FILE = path.join(__dirname, '..', '..', 'data', 'id_map.json');

let state = {
    autoReplyEnabled: true,
    autoReplyContacts: {},
    idMap: {}
};

function loadState() {
    try {
        if (fs.existsSync(TOGGLE_STATE_PATH)) {
            const data = JSON.parse(fs.readFileSync(TOGGLE_STATE_PATH, 'utf-8'));
            state.autoReplyEnabled = data.masterEnabled !== undefined ? data.masterEnabled : true;
            state.autoReplyContacts = data.contacts || {};
            console.log(`✅ Loaded auto-reply state: ${Object.keys(state.autoReplyContacts).length} contacts`);
        }
    } catch (e) {
        console.error('⚠️ Could not load toggle state:', e.message);
    }

    try {
        if (fs.existsSync(MAP_FILE)) {
            state.idMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('⚠️ Could not load id_map.json:', e.message);
    }
}

function saveToggleState() {
    const data = JSON.stringify({ masterEnabled: state.autoReplyEnabled, contacts: state.autoReplyContacts }, null, 2);
    fs.writeFile(TOGGLE_STATE_PATH, data, (err) => {
        if (err) console.error('⚠️ Could not save toggle state:', err.message);
    });
}

function saveIdMap() {
    fs.writeFile(MAP_FILE, JSON.stringify(state.idMap, null, 2), (err) => {
        if (err) console.error('⚠️ Could not save id_map.json:', err.message);
    });
}

function setAutoReplyEnabled(enabled) {
    state.autoReplyEnabled = enabled;
    saveToggleState();
}

function toggleContact(contactId, enabled) {
    state.autoReplyContacts[contactId] = enabled;
    
    const mapped = state.idMap[contactId];
    if (mapped) {
        state.autoReplyContacts[mapped] = enabled;
    }
    saveToggleState();
}

module.exports = {
    state,
    loadState,
    saveToggleState,
    saveIdMap,
    setAutoReplyEnabled,
    toggleContact
};
