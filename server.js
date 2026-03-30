const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Request Logger: Critical for debugging iPhone 12 / ngrok requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- DATABASE CONNECTION & SERVER START ---
let db;
async function startServer() {
    try {
        db = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: 'Antor789@', 
            database: 'bbms_db'
        });
        console.log("Connected to MySQL: bbms_db");

        // Unified Port Listening: Starts ONLY after DB is ready
        const PORT = 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server is LIVE at http://localhost:${PORT}`);
            console.log(`Check ngrok for external access!`);
        });
    } catch (err) {
        console.error("Critical Failure: Could not connect to DB", err.message);
        process.exit(1); 
    }
}

// --- 1. AUTHENTICATION ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        // Querying verified columns: email and password
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

// --- 2. BUS PASS & HISTORY (STUDENT) ---
app.post('/api/bus-pass/request', async (req, res) => {
    try {
        const { user_id, route_name, schedule_id } = req.body;
        const sql = "INSERT INTO buspassrequest (user_id, route_name, schedule_id, status) VALUES (?, ?, ?, 'Pending')";
        await db.execute(sql, [user_id, route_name, schedule_id || 1]);
        res.status(200).json({ message: "Application submitted!" });
    } catch (err) { 
        console.error("Apply Error:", err.message);
        res.status(500).json({ error: "Database error." }); 
    }
});

app.get('/api/student/history/:userId', async (req, res) => {
    // Safety Check: If db is not yet connected, return a 503 instead of a 500 crash
    if (!db) {
        console.error("[500] Database object is undefined!");
        return res.status(503).json({ error: "Database initialization in progress" });
    }

    try {
        const [results] = await db.execute(
            "SELECT * FROM buspassrequest WHERE user_id = ? ORDER BY request_id DESC", 
            [req.params.userId]
        );
        res.status(200).json(results || []); 
    } catch (err) {
        // Log the actual SQL error to your Dell terminal
        console.error("SQL EXECUTION ERROR:", err.message); 
        res.status(500).json({ error: "Server Database Error", details: err.message });
    }
});
// --- 3. NOTIFICATIONS & FEEDBACK ---
app.get('/api/student/notifications/:userId', async (req, res) => {
    try {
        // Matches schema: admin_reply and is_read
        const sql = "SELECT COUNT(*) as unreadCount FROM feedback WHERE user_id = ? AND admin_reply IS NOT NULL AND is_read = 0";
        const [results] = await db.execute(sql, [req.params.userId]);
        const count = (results && results[0]) ? results[0].unreadCount : 0;
        res.status(200).json({ unreadCount: count });
    } catch (err) {
        res.status(200).json({ unreadCount: 0 }); 
    }
});

// --- NEW ROUTE: Fixes the 404 in fetchHistory ---
app.get('/api/student/feedback/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        // Queries verified columns: message, admin_reply, and rating
        const sql = "SELECT feedback_id, message, admin_reply, rating, created_at FROM feedback WHERE user_id = ? ORDER BY created_at DESC";
        const [results] = await db.execute(sql, [userId]);
        
        res.status(200).json(results || []); 
    } catch (err) {
        console.error("Feedback History Error:", err.message);
        res.status(500).json({ error: "Failed to fetch feedback history" });
    }
});

// --- NEW ROUTE: Fixes the Mark as Read call ---
app.put('/api/student/feedback/mark-read/:userId', async (req, res) => {
    try {
        await db.execute("UPDATE feedback SET is_read = 1 WHERE user_id = ? AND is_read = 0", [req.params.userId]);
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// --- 4. BUS STATUS & LOCATION ---
app.get('/api/bus/status', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT bus_number, total_seats, occupied_seats FROM bus WHERE status = "Active" LIMIT 1');
        if (rows.length === 0) return res.status(404).json({ message: "No active bus found" });
        const bus = rows[0];
        res.json({
            ...bus,
            available_seats: bus.total_seats - bus.occupied_seats,
            recommendation: (bus.occupied_seats / bus.total_seats) > 0.8 ? "Bus nearly full." : "Plenty of seats available!"
        });
    } catch (err) { res.status(500).json({ error: "Internal Server Error" }); }
});

app.get('/api/bus/location/:busNumber', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT latitude, longitude, route_name FROM bus_locations WHERE bus_number = ?", [req.params.busNumber]);
        if (rows.length === 0) return res.status(404).json({ message: "Location not found" });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: "Map Sync Error" }); }
});

// --- 5. ADMIN MANAGEMENT ---
app.get('/api/admin/pass-requests', async (req, res) => {
    try {
        const sql = `
            SELECT 
                b.request_id, 
                b.user_id, 
                b.route_name, 
                b.status, 
                u.name AS student_name 
            FROM buspassrequest b 
            /* FIXED: Joined using u.user_id as confirmed by DESCRIBE users */
            JOIN users u ON b.user_id = u.user_id 
            ORDER BY b.request_id DESC
        `;
        const [results] = await db.execute(sql);
        res.status(200).json(results || []); 
    } catch (err) {
        console.error("ADMIN SQL ERROR:", err.message);
        res.status(500).json({ error: "Database query failed. Check table joins." });
    }
});
// Unified Update Pass Status
app.put(['/api/admin/pass-requests/:id', '/api/admin/update-pass/:id'], async (req, res) => {
    try {
        const { status } = req.body;
        await db.execute("UPDATE buspassrequest SET status = ? WHERE request_id = ?", [status, req.params.id]);
        res.json({ success: true, message: `Pass ${status} successfully!` });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
});

app.get('/api/admin/feedback', async (req, res) => {
    try {
        const sql = `
            SELECT f.*, u.name as student_name 
            FROM feedback f 
            JOIN users u ON f.user_id = u.id 
            ORDER BY f.feedback_id DESC
        `;
        const [results] = await db.execute(sql);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch feedback" });
    }
});

// Launch the application
startServer();