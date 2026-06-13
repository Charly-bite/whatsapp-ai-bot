const fs = require('fs');
const path = require('path');

const CONVERSATIONS_DIR = path.join(__dirname, '..', 'data', 'conversaciones');
const USERNAME = '𓄿 𓎡 𓇋 𓆑 𓇋 𓋴';

// Parse a WhatsApp export .txt file and extract conversation pairs
function parseChat(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Regex to match WhatsApp message format: "date, time - sender: message"
    const msgRegex = /^\d{1,2}\/\d{1,2}\/\d{4},\s.+?\s-\s(.+?):\s(.+)$/;
    
    const messages = [];
    
    for (const line of lines) {
        const match = line.match(msgRegex);
        if (match) {
            const sender = match[1].trim();
            const text = match[2].trim();
            
            // Skip multimedia and deleted messages
            if (text === '<Multimedia omitido>' || 
                text === 'Eliminaste este mensaje.' ||
                text === 'Se eliminó este mensaje.' ||
                text === '<Se editó este mensaje.>') {
                continue;
            }
            
            messages.push({
                sender,
                text,
                isUser: sender === USERNAME
            });
        }
    }
    
    return messages;
}

// Extract conversation pairs (someone says something -> user replies)
function extractConversationPairs(messages) {
    const pairs = [];
    
    for (let i = 0; i < messages.length - 1; i++) {
        // Find patterns where someone else messages and then the user replies
        if (!messages[i].isUser && messages[i + 1].isUser) {
            // Collect all consecutive user replies
            let reply = '';
            let j = i + 1;
            while (j < messages.length && messages[j].isUser) {
                reply += (reply ? '\n' : '') + messages[j].text;
                j++;
            }
            
            pairs.push({
                from: messages[i].sender,
                incoming: messages[i].text,
                reply: reply
            });
        }
    }
    
    return pairs;
}

// Extract just the user's messages for style analysis
function extractUserMessages(messages) {
    return messages.filter(m => m.isUser).map(m => m.text);
}

// Build the personality profile
function buildPersonality() {
    const txtFiles = [];
    
    // Recursively find all .txt files in the conversaciones folder
    function findTxtFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findTxtFiles(fullPath);
            } else if (entry.name.endsWith('.txt')) {
                txtFiles.push(fullPath);
            }
        }
    }
    
    findTxtFiles(CONVERSATIONS_DIR);
    
    console.log(`Found ${txtFiles.length} chat files to analyze...`);
    
    let allUserMessages = [];
    let allPairs = [];
    
    for (const file of txtFiles) {
        console.log(`  Parsing: ${path.basename(file)}`);
        const messages = parseChat(file);
        const userMsgs = extractUserMessages(messages);
        const pairs = extractConversationPairs(messages);
        
        allUserMessages = allUserMessages.concat(userMsgs);
        allPairs = allPairs.concat(pairs);
    }
    
    console.log(`\nTotal user messages: ${allUserMessages.length}`);
    console.log(`Total conversation pairs: ${allPairs.length}`);
    
    // Analyze style
    const avgLength = Math.round(allUserMessages.reduce((a, b) => a + b.length, 0) / allUserMessages.length);
    
    // Find most common emojis
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{2934}-\u{2935}\u{25AA}-\u{25FE}\u{2600}-\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu;
    
    const emojiCounts = {};
    for (const msg of allUserMessages) {
        const emojis = msg.match(emojiRegex) || [];
        for (const emoji of emojis) {
            emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
        }
    }
    const topEmojis = Object.entries(emojiCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(e => e[0]);
    
    // Find common phrases/words
    const wordCounts = {};
    for (const msg of allUserMessages) {
        const words = msg.toLowerCase().split(/\s+/);
        for (const word of words) {
            if (word.length > 3) {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
            }
        }
    }
    const topWords = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(e => e[0]);
    
    // Detect languages used
    const spanishWords = ['que', 'hola', 'como', 'pero', 'también', 'pues', 'jaja', 'hahaha', 'bien', 'gracias'];
    const englishWords = ['the', 'you', 'and', 'that', 'have', 'for', 'are', 'with', 'this', 'will'];
    
    let spanishCount = 0;
    let englishCount = 0;
    for (const msg of allUserMessages) {
        const lower = msg.toLowerCase();
        for (const w of spanishWords) { if (lower.includes(w)) spanishCount++; }
        for (const w of englishWords) { if (lower.includes(w)) englishCount++; }
    }
    
    const primaryLanguage = spanishCount > englishCount ? 'Spanish' : 'English';
    const isBilingual = Math.min(spanishCount, englishCount) / Math.max(spanishCount, englishCount) > 0.2;
    
    // Pick random example conversation pairs (up to 15)
    const shuffled = allPairs.sort(() => 0.5 - Math.random());
    const examplePairs = shuffled.slice(0, 15);
    
    // Build the system prompt
    const systemPrompt = `You are impersonating a person in a WhatsApp conversation. You must reply EXACTLY like them based on these characteristics:

PERSONALITY & STYLE:
- Name: Carlos Alberto (also goes by "Clyde" with some people)
- Average message length: ${avgLength} characters (keep messages short and casual like texting)
- Favorite emojis: ${topEmojis.join(' ')}
- Common words/expressions: ${topWords.join(', ')}
- Bilingual: Speaks both Spanish and English. Primary language: SPANISH. You MUST use Spanish by default unless the other person is actively speaking English.
- Texting style: Very casual, uses "hahaha", "jaja", "hehehe" for laughing. Sometimes sends multiple short messages instead of one long one. Uses slang and abbreviations.

RULES:
1. DEFAULT TO SPANISH. Only reply in English if the user specifically writes a full sentence in English.
2. Keep messages SHORT and natural, like real texting. Don't write essays.
3. Use the same emojis and expressions shown above.
4. Be friendly, warm, and sometimes flirty depending on context.
5. DO NOT use formal language. Be casual and natural.
6. Sometimes use "HAHAHA" or "jajaja" when something is funny.
7. You can send just one line or a few short lines, just like real texting.
8. NEVER say you are an AI or a bot. You ARE this person.

EXAMPLE CONVERSATIONS (this is how you talk):
${examplePairs.map(p => `Someone said: "${p.incoming}"\nYou replied: "${p.reply}"`).join('\n\n')}

Now respond to the incoming message naturally, as if you are this person texting on WhatsApp. Keep it brief and authentic.`;

    // Save the profile
    const profile = {
        systemPrompt,
        stats: {
            totalMessages: allUserMessages.length,
            totalPairs: allPairs.length,
            avgLength,
            topEmojis,
            topWords,
            primaryLanguage,
            isBilingual
        }
    };
    
    const profilePath = path.join(__dirname, '..', 'data', 'personality_profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
    
    console.log(`\n✅ Personality profile saved to: ${profilePath}`);
    console.log(`\nStats:`);
    console.log(`  Primary language: ${primaryLanguage}`);
    console.log(`  Bilingual: ${isBilingual}`);
    console.log(`  Avg message length: ${avgLength} chars`);
    console.log(`  Top emojis: ${topEmojis.join(' ')}`);
    console.log(`  Top words: ${topWords.join(', ')}`);
    
    return profile;
}

module.exports = { buildPersonality };

// Run directly if called from CLI
if (require.main === module) {
    buildPersonality();
}
