const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const mysql = require('mysql2');
const colors = require('colors');

const app = express();
app.use(cors());

app.use(express.json({
    limit: '10mb'
}));

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'yt_detector'
});

// Endpoint status
app.get('/status', (req, res) => {
    res.json({ 
        status: 'active', 
        timestamp: new Date().toISOString(),
        version: '1.0'
    });
});

app.post('/predict', (req, res) => {
    // Validasi input
    if (!req.body || !req.body.comment) {
        return res.status(400).json({ 
            error: "Comment is required",
            label: "ERROR",
            confidence: 0
        });
    }
    
    const { comment, videoId, username } = req.body;
    
    console.log(`[${new Date().toLocaleTimeString()}] 📩 REQ: @${username || 'Anonymous'} - "${comment.substring(0, 50)}..."`.cyan);

    const python = spawn('python', ['predict.py', comment]);
    let result = "";
    let errorOutput = "";

    python.stdout.on('data', (d) => { 
        result += d.toString(); 
        console.log("Python stdout:", d.toString());
    });
    
    python.stderr.on('data', (d) => { 
        errorOutput += d.toString(); 
        console.error("Python stderr:", d.toString());
    });
    
    python.on('close', (code) => {
        console.log("Python process closed with code:", code);
        console.log("Raw Python output:", result);
        
        if (code !== 0) {
            console.error(`❌ Python Error: ${errorOutput}`.red);
            return res.status(500).json({ 
                error: "Python execution failed", 
                details: errorOutput,
                label: "ERROR",
                confidence: 0
            });
        }
        
        try {
            const pred = JSON.parse(result.trim());
            console.log(`✅ Parsed prediction:`, pred);
            
            // Validasi respons dari Python
            if (!pred.label || typeof pred.confidence === 'undefined') {
                throw new Error("Invalid prediction format");
            }
            
            // Pastikan confidence adalah number
            const confidence = parseFloat(pred.confidence);
            if (isNaN(confidence)) {
                console.error(`❌ Invalid confidence value: ${pred.confidence}`.red);
                return res.json({ 
                    label: pred.label || "SAFE", 
                    confidence: 0 
                });
            }
            
            console.log(`[${pred.label === 'SPAM JUDI' ? '🚨 SPAM'.red : '✅ SAFE'.green}] ${confidence.toFixed(2)}%`);

            // Simpan ke database
            db.query(
                "INSERT INTO komentar_log (video_id, username, komentar, label, confidence) VALUES (?, ?, ?, ?, ?)",
                [videoId || 'unknown', username || 'Anonymous', comment, pred.label, confidence],
                (err) => {
                    if (err) console.error("❌ DB Error:".red, err.message);
                }
            );

            res.json({ 
                label: pred.label, 
                confidence: confidence 
            });
            
        } catch (e) {
            console.error("❌ JSON Parse Error:".red, e.message);
            console.error("Raw output that failed to parse:", result);
            
            // Fallback response jika Python output tidak valid
            res.json({ 
                label: "SAFE", 
                confidence: 0,
                error: "Invalid Python output",
                raw: result.substring(0, 200)
            });
        }
    });
});

// Error handling
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('❌ JSON Parse Error:', err.message);
        return res.status(400).json({ 
            error: "Invalid JSON format", 
            message: err.message,
            label: "ERROR",
            confidence: 0
        });
    }
    next(err);
});

const PORT = 5000;
app.listen(PORT, () => {
    console.clear();
    console.log("========================================".yellow);
    console.log("   🎯 RADAR JUDI SERVER v1.0".bold.white);
    console.log("   🔗 Address: http://127.0.0.1:5000".cyan);
    console.log("   📊 Status: http://127.0.0.1:5000/status".cyan);
    console.log("========================================".yellow);
    
    // Test koneksi database
    db.getConnection((err, connection) => {
        if (err) {
            console.error('❌ Database connection failed:'.red, err.message);
        } else {
            console.log('✅ Database connected successfully'.green);
            connection.release();
        }
    });
});