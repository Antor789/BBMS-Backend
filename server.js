require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Global DB pool object
let pool;

async function startServer() {
    try {
        const dbUrl = process.env.DATABASE_URL;

        if (!dbUrl) {
            throw new Error("DATABASE_URL is undefined. Check Railway Variables.");
        }

        // Professional Pool Configuration
        pool = mysql.createPool({
            uri: dbUrl,
            ssl: {
                // This is the "professional fix" for cloud handshake errors
                rejectUnauthorized: false 
            },
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });

        // Verify the connection immediately
        const connection = await pool.getConnection();
        console.log("✅ [DB] Successfully connected to Railway MySQL!");
        connection.release(); // Return the connection to the pool

        const PORT = process.env.PORT || 8080;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 [Server] Active and listening on port ${PORT}`);
        });

    } catch (err) {
        console.error("❌ [Critical Failure] DB Connection Error:", err.message);
        // Exponential backoff or simple retry
        console.log("🔄 Retrying connection in 5 seconds...");
        setTimeout(startServer, 5000);
    }
}

// Start the sequence
startServer();

// --- 1. AUTHENTICATION ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [results] = await pool.execute(
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
        await pool.execute(sql, [user_id, route_name, schedule_id || 1]);
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