require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Terlalu banyak request, santai dikit bang 🗿" }
});

// Middleware Cek API Key
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: "API Key salah atau tidak ditemukan!" });
    }
    next();
};

// --- GITHUB API HELPER ---
const GITHUB_URL = `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${process.env.GITHUB_FILE_PATH}`;
const githubHeaders = {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
};

async function getGitHubData() {
    try {
        const response = await axios.get(GITHUB_URL, { headers: githubHeaders });
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return { data: JSON.parse(content), sha: response.data.sha };
    } catch (error) {
        throw new Error("Gagal mengambil data dari GitHub");
    }
}

async function updateGitHubData(newData, sha, message) {
    const encodedContent = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');
    try {
        await axios.put(GITHUB_URL, { message, content: encodedContent, sha }, { headers: githubHeaders });
    } catch (error) {
        throw new Error("Gagal mengupdate data ke GitHub");
    }
}

// --- ROUTES ---

// Endpoint Verifikasi API Key (Buat Frontend)
app.post('/api/verify', apiLimiter, checkApiKey, (req, res) => {
    res.json({ success: true, message: "API Key Valid!" });
});

// Get Semua Nomor
app.get('/api/numbers', checkApiKey, async (req, res) => {
    try {
        const { data } = await getGitHubData();
        res.json({ numbers: data.nomor || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tambah Nomor Baru
app.post('/api/numbers', apiLimiter, checkApiKey, async (req, res) => {
    const { number } = req.body;
    const phoneRegex = /^628\d{8,}$/;
    
    if (!phoneRegex.test(number)) {
        return res.status(400).json({ error: "Format salah. Wajib diawali 628, minimal 11 digit." });
    }

    try {
        const { data, sha } = await getGitHubData();
        if (!data.nomor) data.nomor = [];
        if (data.nomor.includes(number)) return res.status(400).json({ error: "Nomor sudah terdaftar" });

        data.nomor.push(number);
        await updateGitHubData(data, sha, `Tambah whitelist: ${number}`);
        res.json({ message: "Nomor berhasil ditambahkan!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Hapus Nomor
app.delete('/api/numbers/:number', checkApiKey, async (req, res) => {
    const { number } = req.params;
    try {
        const { data, sha } = await getGitHubData();
        if (!data.nomor || !data.nomor.includes(number)) return res.status(404).json({ error: "Nomor tidak ditemukan" });

        data.nomor = data.nomor.filter(n => n !== number);
        await updateGitHubData(data, sha, `Hapus whitelist: ${number}`);
        res.json({ message: "Nomor berhasil dihapus!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fallback Route
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Eksekusi Server (Bisa Lokal & Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
}
module.exports = app;