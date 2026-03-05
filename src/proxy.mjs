import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const LLAMA_SERVER = 'http://127.0.0.1:8080';

app.post('/api/:agent', async (req, res) => {
    const { agent } = req.params;
    const { prompt, history = [] } = req.body;

    console.log(`[Proxy] Routing ${agent} to ${LLAMA_SERVER}`);

    try {
        const response = await fetch(`${LLAMA_SERVER}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: `You are the ${agent} agent. Output ONLY code. No conversational filler.` },
                    ...history,
                    { role: "user", content: prompt }
                ],
                temperature: 0.2,
                stream: false
            })
        });

        const data = await response.json();
        const content = data.choices[0].message.content;
        
        // Return the format the UI expects
        res.json({ agent, content, status: 'success' });
    } catch (err) {
        console.error("Proxy Error:", err.message);
        res.status(500).json({ error: "Agent unreachable", agent });
    }
});

app.get('/api/health', (req, res) => res.json({ status: 'online' }));

const PORT = 3001;
app.listen(PORT, () => console.log(`Matrix Proxy active on port ${PORT}`));
