const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 10000;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Store received RFID data in memory (use a database for persistence)
let rfidLogs = [];

// API endpoint to receive RFID data
app.post('/api/rfid', (req, res) => {
    const { cardID } = req.body;
    if (!cardID) {
        return res.status(400).json({ message: 'Invalid request: cardID is required' });
    }
    
    const timestamp = new Date().toISOString();
    rfidLogs.push({ cardID, timestamp });
    console.log(`RFID Card Received: ${cardID} at ${timestamp}`);
    
    res.status(200).json({ message: 'RFID received', cardID, timestamp });
});

// API to get all stored RFID data
app.get('/api/rfid', (req, res) => {
    res.json(rfidLogs);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});