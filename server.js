const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://app-checkmate-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();

const app = express();
const PORT = 10000;

app.use(bodyParser.json());
app.use(cors());

// API to handle RFID scans (Entry/Exit marking)
app.post('/api/rfid', async (req, res) => {
    const { cardID } = req.body;
    if (!cardID) {
        return res.status(400).json({ message: 'Invalid request: cardID is required' });
    }
    
    const timestamp = new Date().toISOString();
    const attendanceRef = db.collection('attendance').doc(cardID);
    const doc = await attendanceRef.get();
    
    if (!doc.exists) {
        await attendanceRef.set({ entryTime: timestamp, exitTime: null, checkedIn: true });
        return res.json({ message: 'User checked in', cardID, entryTime: timestamp });
    }
    
    const data = doc.data();
    if (data.checkedIn) {
        await attendanceRef.update({ exitTime: timestamp, checkedIn: false });
        return res.json({ message: 'User checked out', cardID, exitTime: timestamp });
    } else {
        await attendanceRef.update({ entryTime: timestamp, exitTime: null, checkedIn: true });
        return res.json({ message: 'User checked in again', cardID, entryTime: timestamp });
    }
});

// API to register a card with a username
app.post('/api/register', async (req, res) => {
    const { cardID, username } = req.body;
    if (!cardID || !username) {
        return res.status(400).json({ message: 'cardID and username are required' });
    }
    
    await db.collection('users').doc(cardID).set({ username });
    res.json({ message: 'User registered successfully', cardID, username });
});

// API to check who is currently checked in
app.get('/api/present', async (req, res) => {
    const snapshot = await db.collection('attendance').where('checkedIn', '==', true).get();
    const presentUsers = snapshot.docs.map(doc => ({ cardID: doc.id, ...doc.data() }));
    res.json(presentUsers);
});

// API to get all registered users
app.get('/api/registered', async (req, res) => {
    const snapshot = await db.collection('users').get();
    const registeredUsers = snapshot.docs.map(doc => ({ cardID: doc.id, ...doc.data() }));
    res.json(registeredUsers);
});

// API to check if a specific UID is checked in
app.get('/api/status/:cardID', async (req, res) => {
    const { cardID } = req.params;
    const doc = await db.collection('attendance').doc(cardID).get();
    if (!doc.exists) {
        return res.status(404).json({ message: 'User not found' });
    }
    res.json(doc.data());
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
