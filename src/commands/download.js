const { isRateLimited } = require('../utils/rateLimiter');
const { MessageMedia } = require('whatsapp-web.js');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const Genius = require('genius-lyrics');
const GeniusClient = new Genius.Client();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const fetch = require('node-fetch') || global.fetch;

module.exports = async function handleDownload(client, msg, argumentsText) {
    const dlCooldown = !msg.fromMe && isRateLimited(msg.from);
    if (dlCooldown) {
        await msg.reply(`⏳ Please wait ${dlCooldown}s before using !download again.`);
        return;
    }
    if (argumentsText) {
        let text = argumentsText.trim();
        
        let isVideo = false;
        let isHq = false;
        
        if (text.includes('-video')) {
            isVideo = true;
            text = text.replace('-video', '').trim();
        }
        if (text.includes('-hq')) {
            isHq = true;
            text = text.replace('-hq', '').trim();
        }
        
        const urlOrQuery = text;

        try {
            // Determine if it's a YouTube URL, Spotify URL, or a search query
            const isYoutubeUrl = urlOrQuery.includes('youtube.com') || urlOrQuery.includes('youtu.be');
            const isSpotifyUrl = urlOrQuery.includes('spotify.com');
            const isUrl = urlOrQuery.startsWith('http://') || urlOrQuery.startsWith('https://');

            let finalQuery = urlOrQuery;

            if (isSpotifyUrl) {
                const chatId = msg.fromMe ? msg.to : msg.from;
                await client.sendMessage(chatId, `🔍 Resolving Spotify link...`);
                try {
                    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(urlOrQuery)}`;
                    const res = await axios.get(oembedUrl);
                    if (res.data && res.data.title) {
                        finalQuery = res.data.title;
                        await client.sendMessage(chatId, `🎵 Found: *${finalQuery}* — searching YouTube...`);
                    } else {
                        throw new Error("No title found in Spotify oembed.");
                    }
                } catch (e) {
                    console.error("Spotify resolve error:", e.message);
                    await msg.reply('⚠️ Could not resolve Spotify link. Make sure it is a valid track link.');
                    return;
                }
            }

            const isDirectMedia = isUrl && finalQuery.match(/\.(mp3|mp4|wav|ogg|m4a|webm|pdf|epub)$/i);

            if (!isDirectMedia) {
                const chatId = msg.fromMe ? msg.to : msg.from;
                const isDirectYtDlpUrl = isUrl && !isSpotifyUrl;

                if (!isSpotifyUrl) {
                    await client.sendMessage(chatId, `🔍 ${isDirectYtDlpUrl ? 'Downloading URL' : 'Searching'}: _${finalQuery}_...`);
                }
                
                console.log(`\nStarting yt-dlp process...`);
                
                let info = null;
                let videoUrl = null;

                if (isDirectYtDlpUrl) {
                    // Direct URL: just get info
                    const rawInfo = await youtubedl(finalQuery, {
                        dumpSingleJson: true,
                        noWarnings: true,
                        noCheckCertificates: true
                    });
                    info = rawInfo;
                    videoUrl = finalQuery;
                } else {
                    // Search: get 5 results, try each until one works
                    const searchResults = await youtubedl(`ytsearch5:${finalQuery}`, {
                        dumpSingleJson: true,
                        noWarnings: true,
                        noCheckCertificates: true,
                        flatPlaylist: true
                    });
                    
                    const candidates = searchResults.entries || [];
                    console.log(`  Found ${candidates.length} search results, trying each...`);
                    
                    for (const candidate of candidates) {
                        const tryUrl = `https://www.youtube.com/watch?v=${candidate.id}`;
                        try {
                            console.log(`  Trying: ${candidate.title} (${candidate.id})`);
                            info = await youtubedl(tryUrl, {
                                dumpSingleJson: true,
                                noWarnings: true,
                                noCheckCertificates: true
                            });
                            videoUrl = tryUrl;
                            console.log(`  ✅ Success: ${info.title}`);
                            break; // Found a working one
                        } catch (tryErr) {
                            console.log(`  ❌ Skipped (${candidate.id}): ${tryErr.message.substring(0, 80)}`);
                            continue; // Try next result
                        }
                    }
                    
                    if (!info) {
                        throw new Error('All search results are unavailable (age-restricted or blocked).');
                    }
                }
                
                const videoTitle = info.title || 'Unknown_Audio';
                const safeTitle = videoTitle.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ +/g, '_');
                
                if (!isYoutubeUrl && !isSpotifyUrl) {
                    await client.sendMessage(chatId, `🎵 Found: *${videoTitle}* — downloading...`);
                }
                
                const tempFilename = `yt_${Date.now()}.${isVideo ? 'mp4' : 'webm'}`;
                const filepath = path.join(__dirname, '..', '..', 'media', tempFilename);
                
                if (isVideo) {
                    await youtubedl(videoUrl, {
                        f: 'best[ext=mp4]/best',
                        o: filepath,
                        noWarnings: true,
                        noCheckCertificates: true
                    });

                    console.log(`\nVideo download complete: ${filepath}. Sending to WhatsApp...`);
                    try {
                        const media = MessageMedia.fromFilePath(filepath);
                        await client.sendMessage(chatId, media, { sendMediaAsDocument: false });
                        console.log(`\nVideo sent successfully!`);
                        fs.unlinkSync(filepath);
                    } catch (sendErr) {
                        console.error('Error sending video to WhatsApp:', sendErr);
                        await msg.reply(`⚠️ Could not send video over WhatsApp (might be too large). Saved on PC at: *${filepath}*`);
                    }

                } else {
                    // Download best audio
                    await youtubedl(videoUrl, {
                        f: 'bestaudio',
                        o: filepath,
                        noWarnings: true,
                        noCheckCertificates: true
                    });
                    
                    console.log(`\nDownload complete. Converting to .m4a with FFmpeg...`);
                    
                    const m4aFilename = `${safeTitle}.m4a`;
                    const m4aPath = path.join(__dirname, '..', '..', 'media', m4aFilename);
                    
                    const bitrate = isHq ? '320k' : '192k';

                    await new Promise((resolve, reject) => {
                        execFile(ffmpegPath, [
                            '-i', filepath,
                            '-vn',              // no video
                            '-acodec', 'aac',   // AAC codec for m4a
                            '-b:a', bitrate,    // configurable bitrate
                            '-y',               // overwrite if exists
                            m4aPath
                        ], (err, stdout, stderr) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    
                    console.log(`\nConversion complete: ${m4aFilename}. Sending to WhatsApp...`);
                    
                    try {
                        const fileData = fs.readFileSync(m4aPath);
                        const base64Data = fileData.toString('base64');
                        
                        const media = new MessageMedia('audio/mp4', base64Data, m4aFilename);
                        await client.sendMessage(chatId, media);
                        
                        console.log(`\nFile sent successfully to WhatsApp!`);
                        
                        // Clean up temp file
                        fs.unlinkSync(filepath);
                        
                        // Now try to fetch and send the lyrics
                        try {
                            let cleanTitle = videoTitle.replace(/\([^()]*\)|\[[^\[\]]*\]/g, '').trim();
                            cleanTitle = cleanTitle.replace(/official|video|audio|music/gi, '').trim();
                            cleanTitle = cleanTitle.replace(/-+$/, '').trim();
                            
                            console.log(`\nSearching for lyrics: "${cleanTitle}" (original: "${videoTitle}")`);
                            
                            let lyricsMsg = null;
                            try {
                                const searches = await GeniusClient.songs.search(cleanTitle);
                                if (searches && searches.length > 0) {
                                    const lyrics = await searches[0].lyrics();
                                    if (lyrics) {
                                        lyricsMsg = `🎶 *Lyrics for: ${searches[0].title}*\n_by ${searches[0].artist.name}_\n\n${lyrics}`;
                                    }
                                }
                            } catch (geniusErr) {
                                console.log('Genius search failed, trying LRCLIB fallback...', geniusErr.message);
                                try {
                                    const query = encodeURIComponent(cleanTitle);
                                    const resp = await fetch(`https://lrclib.net/api/search?q=${query}`);
                                    if (resp.ok) {
                                        const data = await resp.json();
                                        if (data && data.length > 0 && data[0].plainLyrics) {
                                            const track = data[0].trackName || cleanTitle;
                                            const artist = data[0].artistName || 'Unknown Artist';
                                            lyricsMsg = `🎶 *Lyrics for: ${track}*\n_by ${artist}_\n\n${data[0].plainLyrics}`;
                                        }
                                    }
                                } catch(e) {
                                    console.log('LRCLIB fallback also failed:', e.message);
                                }
                            }
                            
                            if (lyricsMsg) {
                                const maxLength = 4000;
                                if (lyricsMsg.length > maxLength) {
                                    lyricsMsg = lyricsMsg.substring(0, maxLength) + '\n\n_... (lyrics truncated)_';
                                }
                                await client.sendMessage(chatId, lyricsMsg);
                                console.log(`\nLyrics sent successfully!`);
                            } else {
                                await client.sendMessage(chatId, '🎵 Lyrics not found for this song.');
                            }
                        } catch (lyricsErr) {
                            console.error('Error fetching lyrics:', lyricsErr.message);
                            await client.sendMessage(chatId, '🎵 Could not fetch lyrics at this time (Service error).');
                        }
                    } catch (sendErr) {
                        console.error('Error sending file to WhatsApp:', sendErr);
                        await msg.reply(`⚠️ Could not send over WhatsApp. The .m4a file is saved on your PC at: *${m4aPath}*`);
                    }
                }

            } else {
                let filename;
                try {
                    filename = path.basename(new URL(finalQuery).pathname);
                } catch (e) {
                    filename = 'downloaded_audio.mp3';
                }
                if (!filename || !filename.includes('.')) filename = 'downloaded_audio.mp3';

                const filepath = path.resolve(__dirname, '..', '..', 'media', filename);
                console.log(`\nStarting download for: ${filename}`);

                const response = await axios({
                    url: finalQuery,
                    method: 'GET',
                    responseType: 'stream'
                });

                const totalLength = parseInt(response.headers['content-length'], 10);
                let downloadedLength = 0;
                let lastLoggedPercent = 0;

                const writer = fs.createWriteStream(filepath);

                response.data.on('data', (chunk) => {
                    downloadedLength += chunk.length;
                    if (totalLength) {
                        const percent = Math.floor((downloadedLength / totalLength) * 100);
                        if (percent >= lastLoggedPercent + 25) {
                            console.log(`Download progress: ${percent}%`);
                            lastLoggedPercent = percent;
                        }
                    }
                });

                await new Promise((resolve, reject) => {
                    response.data.on('error', (err) => {
                        writer.destroy();
                        try { fs.unlinkSync(filepath); } catch (e) { /* already gone */ }
                        reject(err);
                    });
                    writer.on('error', (err) => {
                        try { fs.unlinkSync(filepath); } catch (e) { /* already gone */ }
                        reject(err);
                    });
                    writer.on('finish', resolve);
                    response.data.pipe(writer);
                });

                console.log(`\nDownload complete: ${filepath}. Sending to WhatsApp...`);
                await msg.reply(`✅ Download complete! Sending the file to you now...`);

                try {
                    const media = MessageMedia.fromFilePath(filepath);
                    await msg.reply(media);
                    fs.unlinkSync(filepath);
                } catch (sendErr) {
                    console.error('Error sending file to WhatsApp:', sendErr);
                    await msg.reply('⚠️ The file was downloaded, but it is too large or an error occurred while sending it over WhatsApp.');
                }
            }

        } catch (error) {
            console.error('Download error:', error.message);
            await msg.reply('⚠️ Failed to download the file. Make sure the URL is correct and valid.');
        }
    } else {
        await msg.reply('Please provide a URL or query! \nExample: *!download Despacito*\nExample: *!download https://open.spotify.com/...*\nFlags: *-video* (video), *-hq* (high quality)');
    }
};
