require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});
app.locals.pool = pool;

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bottles', require('./routes/bottles'));
app.use('/api/tastings', require('./routes/tastings'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Cellar running on port ${PORT}`));
