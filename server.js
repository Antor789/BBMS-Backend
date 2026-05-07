require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Using promise-based for async/await
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
let db;

async function startServer() {
    try {
        // Priority 1: Use Railway's DATABASE_URL if available
        // Priority 2: Use local credentials for development
        // Updated connection logic in server.js
const connectionConfig = process.env.DATABASE_URL 
    ? `${process.env.DATABASE_URL}?sslmode=disabled` // Disables SSL for Railway
    : {
        host: 'localhost',
        user: 'root',
        password: 'Antor789', 
        database: 'bbms_db'
    };

db = await mysql.createConnection(connectionConfig);
        console.log("✅ Successfully connected to MySQL Database!");

        // Unified Port Listening: Railway needs process.env.PORT
        const PORT = process.env.PORT || 8080;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server is LIVE on port ${PORT}`);
        });

    } catch (err) {
        console.error("❌ Critical Failure: Could not connect to DB:", err.message);
        process.exit(1); 
    }
}

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- 1. AUTHENTICATION ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [results] = await db.execute(
            "SELECT user_id, name, email, role FROM users WHERE email = ? AND password = ?", 
            [email, password]
        );
        
        if (results.length > 0) {
            res.json({ success: true, user: results[0] });
        } else {
            res.status(401).json({ success: false, message: "Invalid credentials" });
        }
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- 2. BUS PASS & HISTORY ---
app.post('/api/bus-pass/request', async (req, res) => {
    try {
        const { user_id, route_name, schedule_id } = req.body;
        const sql = "INSERT INTO buspassrequest (user_id, route_name, schedule_id, status) VALUES (?, ?, ?, 'Pending')";
        await db.execute(sql, [user_id, route_name, schedule_id || 1]);
        res.status(200).json({ message: "Application submitted!" });
    } catch (err) { 
        res.status(500).json({ error: "Database error." }); 
    }
});

app.get('/api/student/history/:userId', async (req, res) => {
    try {
        const [results] = await db.execute(
            "SELECT * FROM buspassrequest WHERE user_id = ? ORDER BY request_id DESC", 
            [req.params.userId]
        );
        res.status(200).json(results || []); 
    } catch (err) {
        res.status(500).json({ error: "Server Database Error", details: err.message });
    }
});

app.get('/api/student/my-passes/:userId', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM buspassrequest WHERE user_id = ?", [req.params.userId]);
        res.status(200).json(rows);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- 3. FEEDBACK ---
app.post('/api/feedback', async (req, res) => {
    const { userId, message, rating } = req.body;
    if (!userId || !message) return res.status(400).json({ error: "Missing data." });

    try {
        await db.execute(
            "INSERT INTO feedback (user_id, message, rating) VALUES (?, ?, ?)",
            [userId, message, rating]
        );
        res.status(201).json({ message: "Feedback sent!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/student/feedback/:userId', async (req, res) => {
    try {
        const [results] = await db.execute(
            "SELECT feedback_id, message, admin_reply, rating, created_at FROM feedback WHERE user_id = ? ORDER BY created_at DESC",
            [req.params.userId]
        );
        res.status(200).json(results || []); 
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch feedback history" });
    }
});

// --- 4. MAP & STATUS ---
app.get('/api/map/live-view', async (req, res) => {
    try {
        const [buses] = await db.execute("SELECT * FROM bus_status WHERE status = 'active'");
        const [stops] = await db.execute("SELECT * FROM bus_stops");
        res.status(200).json({ buses, stops });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/api/bus/live-status/:busId', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM bus_status WHERE bus_id = ?", [req.params.busId]);
        if (rows.length === 0) return res.status(404).json({ error: "Bus not found" });
        res.status(200).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Start the sequence
startServer();