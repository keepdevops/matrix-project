import express from 'express';
import path from 'path';
import authRoutes from './routes/auth.js';

const app = express();
const __dirname = path.resolve();

app.use(express.json());

// 1. Serve static files (CSS, JS) from the public folder
app.use(express.static('public'));

// 2. Map the Auth API
app.use('/v1/auth', authRoutes);

// 3. Define the LANDING PAGE
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.listen(3000, () => {
    console.log('🚀 MATRIX_CORE: Online at http://localhost:3000');
});
