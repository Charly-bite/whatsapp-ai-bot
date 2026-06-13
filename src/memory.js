const sql = require('mssql');

const DB_CONFIG = {
    server: process.env.DB_SERVER || '192.168.2.187',
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    authentication: {
        type: 'ntlm',
        options: {
            domain: '',
            userName: process.env.DB_USER || 'Administrador',
            password: process.env.DB_PASSWORD || ''
        }
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool = null;

// Initialize database and tables
async function initDatabase() {
    // Connect to master first to create DB
    const masterPool = await sql.connect({ ...DB_CONFIG, database: 'master' });
    
    // Create database if not exists
    await masterPool.request().query(`
        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'whatsapp_bot')
        CREATE DATABASE whatsapp_bot
    `);
    await masterPool.close();

    // Connect to our database
    pool = await sql.connect({ ...DB_CONFIG, database: 'whatsapp_bot' });
    
    pool.on('error', err => {
        console.error('Database connection error:', err);
        pool = null;
    });

    // Create conversations table
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='conversations' AND xtype='U')
        CREATE TABLE conversations (
            id INT IDENTITY(1,1) PRIMARY KEY,
            chat_id NVARCHAR(100) NOT NULL,
            sender NVARCHAR(100) NOT NULL,
            sender_name NVARCHAR(255) NULL,
            message NVARCHAR(MAX) NOT NULL,
            is_from_me BIT DEFAULT 0,
            is_auto_reply BIT DEFAULT 0,
            tokens_used INT DEFAULT 0,
            created_at DATETIME2 DEFAULT GETDATE()
        )
    `);

    // Create indexes
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_chat_id' AND object_id = OBJECT_ID('conversations'))
        CREATE INDEX idx_chat_id ON conversations(chat_id);
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_chat_time' AND object_id = OBJECT_ID('conversations'))
        CREATE INDEX idx_chat_time ON conversations(chat_id, created_at);
    `);

    // Create chat_stats table
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='chat_stats' AND xtype='U')
        CREATE TABLE chat_stats (
            chat_id NVARCHAR(100) PRIMARY KEY,
            chat_name NVARCHAR(255) NULL,
            total_messages INT DEFAULT 0,
            total_auto_replies INT DEFAULT 0,
            total_tokens INT DEFAULT 0,
            last_message_at DATETIME2 DEFAULT GETDATE(),
            updated_at DATETIME2 DEFAULT GETDATE()
        )
    `);

    console.log('✅ MSSQL memory bank connected and ready!');
    return pool;
}

async function getPool() {
    if (!pool) {
        try {
            pool = await sql.connect({ ...DB_CONFIG, database: 'whatsapp_bot' });
            pool.on('error', err => {
                console.error('Database connection error:', err);
                pool = null;
            });
        } catch (err) {
            console.error('Failed to reconnect to MSSQL:', err.message);
            return null;
        }
    }
    return pool;
}

// Save an incoming or outgoing message
async function saveMessage(chatId, sender, senderName, message, isFromMe = false, isAutoReply = false, tokensUsed = 0) {
    const p = await getPool();
    if (!p || !message || message.trim().length === 0) return;
    
    try {
        await p.request()
            .input('chatId', sql.NVarChar, chatId)
            .input('sender', sql.NVarChar, sender)
            .input('senderName', sql.NVarChar, senderName || null)
            .input('message', sql.NVarChar, message)
            .input('isFromMe', sql.Bit, isFromMe ? 1 : 0)
            .input('isAutoReply', sql.Bit, isAutoReply ? 1 : 0)
            .input('tokensUsed', sql.Int, tokensUsed)
            .query(`INSERT INTO conversations (chat_id, sender, sender_name, message, is_from_me, is_auto_reply, tokens_used) 
                    VALUES (@chatId, @sender, @senderName, @message, @isFromMe, @isAutoReply, @tokensUsed)`);

        // Upsert chat stats
        await pool.request()
            .input('chatId', sql.NVarChar, chatId)
            .input('chatName', sql.NVarChar, senderName)
            .input('isAutoReply', sql.Bit, isAutoReply ? 1 : 0)
            .input('tokensUsed', sql.Int, tokensUsed)
            .query(`
                MERGE chat_stats AS target
                USING (VALUES (@chatId)) AS source(chat_id)
                ON target.chat_id = source.chat_id
                WHEN MATCHED THEN
                    UPDATE SET 
                        chat_name = COALESCE(@chatName, target.chat_name),
                        total_messages = target.total_messages + 1,
                        total_auto_replies = target.total_auto_replies + CAST(@isAutoReply AS INT),
                        total_tokens = target.total_tokens + @tokensUsed,
                        last_message_at = GETDATE(),
                        updated_at = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (chat_id, chat_name, total_messages, total_auto_replies, total_tokens, last_message_at)
                    VALUES (@chatId, @chatName, 1, CAST(@isAutoReply AS INT), @tokensUsed, GETDATE());
            `);
    } catch (err) {
        console.error('❌ Memory save error:', err.message);
    }
}

// Get recent conversation history for context
async function getConversationHistory(chatId, limit = 15) {
    const p = await getPool();
    if (!p) return [];
    
    try {
        const result = await p.request()
            .input('chatId', sql.NVarChar, chatId)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) sender_name, message, is_from_me, created_at 
                FROM conversations 
                WHERE chat_id = @chatId 
                ORDER BY created_at DESC
            `);
        
        // Reverse to get chronological order and truncate long messages
        return result.recordset.reverse().map(r => ({
            who: r.is_from_me ? 'Me' : (r.sender_name || 'Them'),
            msg: r.message.length > 500 ? r.message.substring(0, 500) + '...[truncated]' : r.message,
            time: r.created_at
        }));
    } catch (err) {
        console.error('❌ Memory read error:', err.message);
        return [];
    }
}

// Get global stats
async function getGlobalStats() {
    const p = await getPool();
    if (!p) return { totalMessages: 0, totalAutoReplies: 0, totalTokens: 0, activeChats: 0 };
    
    try {
        const result = await p.request().query(`
            SELECT 
                ISNULL(SUM(total_messages), 0) as totalMessages,
                ISNULL(SUM(total_auto_replies), 0) as totalAutoReplies,
                ISNULL(SUM(total_tokens), 0) as totalTokens,
                COUNT(*) as activeChats
            FROM chat_stats
        `);
        return result.recordset[0];
    } catch (err) {
        console.error('❌ Stats error:', err.message);
        return { totalMessages: 0, totalAutoReplies: 0, totalTokens: 0, activeChats: 0 };
    }
}

// Get recent conversations for dashboard
async function getRecentConversations(limit = 50) {
    const p = await getPool();
    if (!p) return [];
    
    try {
        const result = await p.request()
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) chat_id, sender_name, message, is_from_me, is_auto_reply, tokens_used, created_at 
                FROM conversations 
                ORDER BY created_at DESC
            `);
        return result.recordset;
    } catch (err) {
        console.error('❌ Recent convos error:', err.message);
        return [];
    }
}

// Get recent AI conversations specifically
async function getActiveAiChats(limit = 100) {
    const p = await getPool();
    if (!p) return [];
    
    try {
        const result = await p.request()
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) chat_id, sender_name, message, is_from_me, is_auto_reply, tokens_used, created_at 
                FROM conversations 
                WHERE is_auto_reply = 1
                ORDER BY created_at DESC
            `);
        return result.recordset;
    } catch (err) {
        console.error('❌ Active AI chats error:', err.message);
        return [];
    }
}

// Get daily stats for charts
async function getDailyStats(days = 7) {
    const p = await getPool();
    if (!p) return [];
    
    try {
        const result = await p.request()
            .input('days', sql.Int, days)
            .query(`
                SELECT 
                    CAST(created_at AS DATE) as date,
                    COUNT(*) as messages,
                    SUM(CAST(is_auto_reply AS INT)) as ai_replies,
                    SUM(tokens_used) as tokens
                FROM conversations
                WHERE created_at >= DATEADD(day, -@days, GETDATE())
                GROUP BY CAST(created_at AS DATE)
                ORDER BY date ASC
            `);
        return result.recordset;
    } catch (err) {
        console.error('❌ Daily stats error:', err.message);
        return [];
    }
}

module.exports = {
    initDatabase,
    saveMessage,
    getConversationHistory,
    getGlobalStats,
    getRecentConversations,
    getActiveAiChats,
    getDailyStats
};
