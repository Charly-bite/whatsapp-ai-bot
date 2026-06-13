const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch') || global.fetch;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

/**
 * Cascade LLM Generator
 * Attempts: Gemini -> Groq -> Local Ollama
 */
async function generateAIResponse(promptText, systemInstruction, imageBase64 = null, imageMimeType = null) {
    let reply = '';
    let totalTkns = 0;
    const hasImage = !!(imageBase64 && imageMimeType);

    // 1. Google Gemini
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: systemInstruction 
        });

        const promptParts = [promptText];
        if (hasImage) {
            promptParts.push({
                inlineData: {
                    data: imageBase64,
                    mimeType: imageMimeType
                }
            });
            promptParts[0] = promptText + "\n[The user has attached an image. Describe or react to it naturally.]";
        }

        const result = await model.generateContent(promptParts);
        reply = result.response.text() || '';
        totalTkns = result.response.usageMetadata ? result.response.usageMetadata.totalTokenCount : Math.round((promptParts[0].length + reply.length) / 4);
        
        return { reply: reply.replace(/^"|"$/g, '').trim(), tokens: totalTkns, source: 'Gemini' };
    } catch (geminiError) {
        console.warn(`  ⚠️ Gemini failed (${geminiError.message}). Attempting fallback...`);
    }

    // 2. Groq Fallback (Text only)
    if (!hasImage && process.env.GROQ_API_KEY) {
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: promptText }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                })
            });

            if (groqRes.ok) {
                const data = await groqRes.json();
                reply = data.choices[0]?.message?.content || '';
                totalTkns = data.usage?.total_tokens || Math.round((promptText.length + reply.length) / 4);
                return { reply: reply.replace(/^"|"$/g, '').trim(), tokens: totalTkns, source: 'Groq' };
            } else {
                const errData = await groqRes.text();
                console.warn(`  ⚠️ Groq failed: ${errData}`);
            }
        } catch (groqError) {
            console.warn(`  ⚠️ Groq fetch failed (${groqError.message}). Attempting local fallback...`);
        }
    }

    // 3. Local Ollama Fallback
    try {
        const payload = {
            model: hasImage ? 'llava' : (process.env.OLLAMA_MODEL_REPLY || 'hermes3:latest'),
            system: systemInstruction,
            prompt: promptText,
            stream: false
        };
        if (hasImage) {
            payload.images = [imageBase64];
            payload.prompt = promptText + "\n[The user has attached an image. Describe or react to it naturally.]";
        }
        
        const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await ollamaRes.json();
        reply = data.response || '';
        totalTkns = (data.prompt_eval_count || 0) + (data.eval_count || 0);
        return { reply: reply.replace(/^"|"$/g, '').trim(), tokens: totalTkns, source: 'Ollama' };
    } catch (ollamaError) {
        console.error(`  ❌ All AI providers failed. Local Ollama Error: ${ollamaError.message}`);
        throw new Error('All AI providers failed');
    }
}

module.exports = { generateAIResponse };
