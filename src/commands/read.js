const { isRateLimited } = require('../utils/rateLimiter');
const { MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch') || global.fetch;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

module.exports = async function handleRead(client, msg, argumentsText) {
    const readCooldown = !msg.fromMe && isRateLimited(msg.from);
    if (readCooldown) {
        await msg.reply(`⏳ Please wait ${readCooldown}s before using !read again.`);
        return;
    }
    if (argumentsText) {
        let text = argumentsText.trim();
        
        let authorQuery = null;
        const authorMatch = text.match(/-author\s+([^-\n]+)/i);
        if (authorMatch) {
            authorQuery = authorMatch[1].trim();
            text = text.replace(authorMatch[0], '').trim();
        }

        const langMap = { en: 'eng', es: 'spa', fr: 'fre', de: 'ger', pt: 'por', it: 'ita', zh: 'chi', ja: 'jpn', ko: 'kor', ru: 'rus', ar: 'ara', nl: 'dut', sv: 'swe', pl: 'pol', tr: 'tur', hi: 'hin' };
        
        let langMatch = text.match(/^(.+?)\s+-([a-z]{2})$/i);
        if (!langMatch) {
            const noDashMatch = text.match(/^(.+?)\s+([a-z]{2})$/i);
            if (noDashMatch && langMap[noDashMatch[2].toLowerCase()]) {
                langMatch = noDashMatch;
            }
        }
        
        const bookQuery = langMatch ? langMatch[1].trim() : text;
        const langFilter = langMatch ? langMap[langMatch[2].toLowerCase()] || null : null;
        const langLabel = langMatch ? langMatch[2].toUpperCase() : null;
        
        const chatId = msg.fromMe ? msg.to : msg.from;
        
        try {
            const langMsg = langFilter ? ` (${langLabel})` : '';
            const authorMsg = authorQuery ? ` by ${authorQuery}` : '';
            await client.sendMessage(chatId, `📚 Searching for: _${bookQuery}${authorMsg}_${langMsg}...`);
            console.log(`\n[BOOK] Searching Open Library for: "${bookQuery}"${authorQuery ? ` by "${authorQuery}"` : ''}${langFilter ? ` [lang: ${langFilter}]` : ''}`);
            
            const searchLimit = langFilter ? 25 : 10;
            let searchUrl = `https://openlibrary.org/search.json?limit=${searchLimit}&fields=title,author_name,ia,ebook_access,has_fulltext,first_publish_year,language`;
            
            if (bookQuery) {
                searchUrl += `&q=${encodeURIComponent(bookQuery)}`;
            }
            if (authorQuery) {
                searchUrl += `&author=${encodeURIComponent(authorQuery)}`;
            }

            let searchResp;
            try {
                searchResp = await axios.get(searchUrl, { timeout: 15000 });
            } catch (apiErr) {
                if (apiErr.response && apiErr.response.status === 422) {
                    await client.sendMessage(chatId, `⚠️ Your search query "${bookQuery}" is too short or invalid. Please provide a longer book title or author name.`);
                    return;
                }
                throw apiErr;
            }
            const allBooks = searchResp.data.docs || [];
            
            let downloadableBooks = allBooks.filter(b => 
                b.ia && b.ia.length > 0 && 
                (b.ebook_access === 'public' || b.ebook_access === 'borrowable')
            );
            
            if (langFilter && downloadableBooks.length > 0) {
                const langFiltered = downloadableBooks.filter(b => 
                    b.language && b.language.includes(langFilter)
                );
                if (langFiltered.length > 0) {
                    downloadableBooks = langFiltered;
                } else {
                    await client.sendMessage(chatId, `⚠️ No ${langLabel} version found, showing best available result...`);
                }
            }
            
            if (downloadableBooks.length === 0) {
                const suggestion = allBooks.length > 0 
                    ? `\n\n_Found "${allBooks[0].title}" but it's not available for free download._`
                    : '';
                await client.sendMessage(chatId, `📚 No downloadable books found.${suggestion}\n\n_Try searching with a different title or author._`);
                return;
            }
            
            downloadableBooks.sort((a, b) => {
                if (a.ebook_access === 'public' && b.ebook_access !== 'public') return -1;
                if (b.ebook_access === 'public' && a.ebook_access !== 'public') return 1;
                return 0;
            });
            
            let downloadUrl = null;
            let fileName = null;
            let fileSize = 0;
            let fileFormat = 'pdf';
            let bookTitle = '';
            let bookAuthor = '';
            let bookYear = '';
            let statusSent = false;
            
            for (const book of downloadableBooks.slice(0, 5)) {
                bookTitle = book.title;
                bookAuthor = (book.author_name || ['Unknown']).join(', ');
                bookYear = book.first_publish_year || '?';
                
                if (!statusSent) {
                    await client.sendMessage(chatId, `📖 Found: *${bookTitle}*\n_by ${bookAuthor} (${bookYear})_\n\n⬇️ Downloading...`);
                    statusSent = true;
                }
                
                const iaIds = book.ia.slice(0, 8);
                for (const iaId of iaIds) {
                    try {
                        const metaResp = await axios.get(`https://archive.org/metadata/${iaId}`, { timeout: 10000 });
                        const files = metaResp.data.files || [];
                        
                        const textPdf = files.find(f => f.name.endsWith('_text.pdf'));
                        const anyPdf = files.find(f => f.name.endsWith('.pdf'));
                        const epub = files.find(f => f.name.endsWith('.epub'));
                        
                        const target = textPdf || anyPdf || epub;
                        
                        if (target) {
                            const sizeMB = parseInt(target.size) / (1024 * 1024);
                            if (sizeMB > 95) continue;
                            
                            const candidateUrl = `https://archive.org/download/${iaId}/${encodeURIComponent(target.name)}`;
                            
                            try {
                                const headResp = await axios.head(candidateUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                                if (headResp.status === 200) {
                                    downloadUrl = candidateUrl;
                                    fileName = target.name;
                                    fileSize = parseInt(target.size);
                                    fileFormat = target.name.endsWith('.epub') ? 'epub' : 'pdf';
                                    break;
                                }
                            } catch (headErr) {
                                continue;
                            }
                        }
                    } catch (iaErr) {
                        continue;
                    }
                }
                if (downloadUrl) break;
            }

            if (!downloadUrl) {
                console.log(`[BOOK] Open Library sources exhausted. Trying IA direct search...`);
                try {
                    const iaLangFilter = langFilter ? `+AND+language:${langFilter === 'spa' ? 'spa' : langFilter === 'eng' ? 'eng' : langFilter}` : '';
                    let titleQ = bookQuery ? `title:${encodeURIComponent('"' + bookQuery + '"')}` : '';
                    let creatorQ = authorQuery ? `creator:${encodeURIComponent('"' + authorQuery + '"')}` : '';
                    
                    let queryParts = [];
                    if (titleQ) queryParts.push(titleQ);
                    if (creatorQ) queryParts.push(creatorQ);
                    const finalQ = queryParts.join('+AND+');

                    const iaSearchUrl = `https://archive.org/advancedsearch.php?q=${finalQ}+AND+mediatype:texts${iaLangFilter}&fl[]=identifier,title,language&rows=10&output=json`;
                    
                    const iaResp = await axios.get(iaSearchUrl, { timeout: 15000 });
                    const iaDocs = iaResp.data.response?.docs || [];
                    
                    for (const doc of iaDocs) {
                        try {
                            const metaResp = await axios.get(`https://archive.org/metadata/${doc.identifier}`, { timeout: 10000 });
                            const files = metaResp.data.files || [];
                            
                            const textPdf = files.find(f => f.name.endsWith('_text.pdf'));
                            const anyPdf = files.find(f => f.name.endsWith('.pdf'));
                            const epub = files.find(f => f.name.endsWith('.epub'));
                            const target = textPdf || anyPdf || epub;
                            
                            if (target) {
                                const sizeMB = parseInt(target.size) / (1024 * 1024);
                                if (sizeMB > 95) continue;
                                
                                const candidateUrl = `https://archive.org/download/${doc.identifier}/${encodeURIComponent(target.name)}`;
                                try {
                                    const headResp = await axios.head(candidateUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                                    if (headResp.status === 200) {
                                        downloadUrl = candidateUrl;
                                        fileName = target.name;
                                        fileSize = parseInt(target.size);
                                        fileFormat = target.name.endsWith('.epub') ? 'epub' : 'pdf';
                                        bookTitle = doc.title || bookQuery || 'Unknown Book';
                                        
                                        if (!statusSent) {
                                            await client.sendMessage(chatId, `📖 Found: *${bookTitle}*\n\n⬇️ Downloading...`);
                                            statusSent = true;
                                        }
                                        break;
                                    }
                                } catch (headErr) {
                                }
                            }
                        } catch (docErr) {
                        }
                    }
                } catch (iaSearchErr) {
                }
            }
            
            if (!downloadUrl) {
                const failTitle = downloadableBooks.length > 0 ? downloadableBooks[0].title : bookQuery;
                await client.sendMessage(chatId, `📚 Couldn't find a downloadable version of "${failTitle}".\n\n_The book may only be available for borrowing on archive.org._`);
                return;
            }
            
            const safeTitle = bookTitle.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ +/g, '_');
            const localFilename = `${safeTitle}.${fileFormat}`;
            const localPath = path.join(__dirname, '..', '..', 'media', localFilename);
            
            const dlResp = await axios({
                url: downloadUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 120000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            
            const writer = fs.createWriteStream(localPath);
            await new Promise((resolve, reject) => {
                dlResp.data.on('error', (err) => {
                    writer.destroy();
                    try { fs.unlinkSync(localPath); } catch(e) {}
                    reject(err);
                });
                writer.on('error', (err) => {
                    try { fs.unlinkSync(localPath); } catch(e) {}
                    reject(err);
                });
                writer.on('finish', resolve);
                dlResp.data.pipe(writer);
            });
            
            const finalSize = fs.statSync(localPath).size;
            const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(1);
            
            try {
                const mimeType = fileFormat === 'epub' ? 'application/epub+zip' : 'application/pdf';
                const fileData = fs.readFileSync(localPath);
                const base64Data = fileData.toString('base64');
                const media = new MessageMedia(mimeType, base64Data, localFilename);
                await client.sendMessage(chatId, media, { sendMediaAsDocument: true });
                
                await client.sendMessage(chatId, `✅ *${bookTitle}*\n_by ${bookAuthor} (${bookYear})_\n📄 ${fileFormat.toUpperCase()} — ${finalSizeMB}MB`);
                
                fs.unlinkSync(localPath);

                // Generate AI summary
                try {
                    const prompt = `Write a short, engaging summary (about 3 sentences) for the book "${bookTitle}" by ${bookAuthor}. Keep it concise and spoiler-free.`;
                    const aiRes = await fetch(`${OLLAMA_URL}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: process.env.OLLAMA_MODEL_REPLY || 'mistral-nemo:latest',
                            prompt: prompt,
                            stream: false
                        })
                    });
                    const data = await aiRes.json();
                    if (data && data.response) {
                        await client.sendMessage(chatId, `💡 *Summary:*\n_${data.response.trim()}_`);
                    }
                } catch (summaryErr) {
                    console.error('Failed to generate summary:', summaryErr.message);
                }

            } catch (sendErr) {
                console.error('[BOOK] Send error:', sendErr.message);
                await client.sendMessage(chatId, `⚠️ Downloaded but couldn't send via WhatsApp (file may be too large).\n\nSaved on PC: *${localPath}*`);
            }
            
        } catch (error) {
            console.error('[BOOK] Error:', error.message);
            await msg.reply('⚠️ Failed to find or download the book. Try a different title or author.');
        }
    } else {
        await msg.reply('📚 Please provide a book title!\n\nExample: *!read The Great Gatsby*\nExample: *!read -author Gabriel Garcia Marquez*\n\n🌐 Add a language flag:\n*!read The Great Gatsby -es* (Spanish)');
    }
};
