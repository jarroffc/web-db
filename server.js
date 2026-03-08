require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware Keamanan & Parsing
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting (5 request per menit)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Terlalu banyak request, coba lagi sebentar." }
});

// Middleware Autentikasi JWT
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Akses ditolak. Token tidak ada." });
    
    try {
        const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Sesi tidak valid atau kadaluarsa." });
    }
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
        console.error("GitHub GET Error:", error.response?.data || error.message);
        throw new Error("Gagal mengambil data dari GitHub");
    }
}

async function updateGitHubData(newData, sha, message) {
    const encodedContent = Buffer.from(JSON.stringify(newData, null, 2)).toString('base64');
    try {
        await axios.put(GITHUB_URL, {
            message: message,
            content: encodedContent,
            sha: sha
        }, { headers: githubHeaders });
    } catch (error) {
        console.error("GitHub PUT Error:", error.response?.data || error.message);
        throw new Error("Gagal mengupdate data ke GitHub");
    }
}

// --- ROUTES ---

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.OWNER_USERNAME && password === process.env.OWNER_PASSWORD) {
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: "Username atau Password salah!" });
    }
});

// Get Semua Nomor
app.get('/api/numbers', verifyToken, async (req, res) => {
    try {
        const { data } = await getGitHubData();
        res.json({ numbers: data.nomor || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tambah Nomor Baru
app.post('/api/numbers', apiLimiter, verifyToken, async (req, res) => {
    const { number, apiKey } = req.body;

    // 1. Validasi API Key
    if (apiKey !== process.env.API_KEY) {
        return res.status(403).json({ error: "API Key tidak valid!" });
    }

    // 2. Validasi Format Nomor
    const phoneRegex = /^628\d{8,}$/;
    if (!phoneRegex.test(number)) {
        return res.status(400).json({ error: "Format salah. Wajib diawali 628, minimal 11 digit, tanpa spasi/simbol (+/-)." });
    }

    try {
        const { data, sha } = await getGitHubData();
        
        // 3. Cek Duplikat
        if (!data.nomor) data.nomor = [];
        if (data.nomor.includes(number)) {
            return res.status(400).json({ error: "Nomor sudah terdaftar" });
        }

        // Tambah & Update GitHub
        data.nomor.push(number);
        await updateGitHubData(data, sha, `Tambah whitelist: ${number}`);
        
        console.log(`[LOG] Nomor ditambahkan: ${number}`);
        res.json({ message: "Nomor berhasil ditambahkan!" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Hapus Nomor
app.delete('/api/numbers/:number', verifyToken, async (req, res) => {
    const { number } = req.params;

    try {
        const { data, sha } = await getGitHubData();
        
        if (!data.nomor || !data.nomor.includes(number)) {
            return res.status(404).json({ error: "Nomor tidak ditemukan" });
        }

        // Hapus & Update GitHub
        data.nomor = data.nomor.filter(n => n !== number);
        await updateGitHubData(data, sha, `Hapus whitelist: ${number}`);
        
        console.log(`[LOG] Nomor dihapus: ${number}`);
        res.json({ message: "Nomor berhasil dihapus!" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fallback Route
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Biar bisa jalan di VPS lokal DAN Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
}

// WAJIB ADA BUAT VERCEL
module.exports = app;