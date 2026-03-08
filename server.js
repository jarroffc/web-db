require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting - 30 Detik
const apiLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    message: { error: "Terlalu banyak request, tuggu 30 detik" }
});

// Middleware Cek API Key (Ganti 'jarrxd' kalau mau beda)
const checkApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    // Pakai process.env.API_KEY atau tembak langsung 'jarrxd'
    const validKey = process.env.API_KEY || 'jarrxd';
    if (!apiKey || apiKey !== validKey) {
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
        console.error("GitHub Get Error:", error.response ? error.response.data : error.message);
        throw new Error("Gagal mengambil data dari GitHub. Cek Token/Repo!");
    }
}

async function updateGitHubData(newData, sha, message) {
    const encodedContent = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');
    try {
        await axios.put(GITHUB_URL, { message, content: encodedContent, sha }, { headers: githubHeaders });
    } catch (error) {
        console.error("GitHub Put Error:", error.response ? error.response.data : error.message);
        throw new Error("Gagal mengupdate data ke GitHub.");
    }
}

// --- ROUTES ---

// Verify API Key
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

    // Filter Nomor (Bebas, yang penting angka & min 5 digit)
    if (!number || number.length < 5 || isNaN(number)) {
        return res.status(400).json({ error: "Format salah! Harus angka & minimal 5 digit." });
    }

    try {
        const { data, sha } = await getGitHubData();
        if (!data.nomor) data.nomor = [];
        
        if (data.nomor.includes(number)) {
            return res.status(400).json({ error: "Nomor sudah ada di database!" });
        }

        data.nomor.push(number);
        await updateGitHubData(data, sha, `Tambah whitelist: ${number}`);
        res.json({ message: "Nomor berhasil ditambahkan ke GitHub!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Hapus Nomor
app.delete('/api/numbers/:number', checkApiKey, async (req, res) => {
    const { number } = req.params;
    try {
        const { data, sha } = await getGitHubData();
        if (!data.nomor || !data.nomor.includes(number)) {
            return res.status(404).json({ error: "Nomor tidak ditemukan!" });
        }

        data.nomor = data.nomor.filter(n => n !== number);
        await updateGitHubData(data, sha, `Hapus whitelist: ${number}`);
        res.json({ message: "Nomor berhasil dihapus dari GitHub!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fallback ke Frontend
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hapus bagian app.listen yang lama, ganti jadi ini:

// Khusus buat Vercel biar bisa baca Express-nya
module.exports = app; 

// Khusus buat VPS (biar tetep bisa jalan pake PM2/Node)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
        =======================================
        SERVER JARR ON PORT: ${PORT}
        API KEY: ${process.env.API_KEY || 'jarrxd'}
        =======================================
        `);
    });
}