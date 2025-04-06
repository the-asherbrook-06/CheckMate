const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase Admin Init
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

// --- Constants ---
const PERIODS = {
    Hour1: ['08:40', '09:40'],
    Hour2: ['09:40', '10:40'],
    Break: ['10:40', '11:00'],
    Hour3: ['11:00', '12:00'],
    Hour4: ['12:00', '13:00'],
    Lunch: ['13:00', '13:40'],
    Hour5: ['13:40', '14:30'],
    Hour6: ['14:30', '15:20'],
    Hour7: ['15:20', '16:10'],
};

// --- Helper Functions ---
function getTodayDateString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function parseTime(timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    return hour * 60 + minute;
}

function getMinutesSinceMidnight(date = new Date()) {
    return date.getHours() * 60 + date.getMinutes();
}

function getPresentPeriods(entryDate, exitDate) {
    const entryMinutes = getMinutesSinceMidnight(entryDate);
    const exitMinutes = getMinutesSinceMidnight(exitDate);
    const attended = {};

    for (const [period, [start, end]] of Object.entries(PERIODS)) {
        const startMin = parseTime(start);
        const endMin = parseTime(end);
        if (exitMinutes > startMin && entryMinutes < endMin) {
            attended[period] = true;
        }
    }
    return attended;
}

// --- API: RFID Scan (Check-in/out) ---
app.post('/api/rfid', async (req, res) => {
    const { cardID } = req.body;
    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = getTodayDateString();

    if (!cardID) {
        return res.status(400).json({ message: 'Invalid request: cardID is required' });
    }

    try {
        // Check registration
        const userDoc = await db.collection('Registered Students').doc(cardID).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: 'not registered', cardID });
        }

        const userData = userDoc.data();
        const name = userData.name || 'Unknown';

        const attendanceDoc = db.collection('attendance').doc(dateKey).collection('records').doc(cardID);
        const doc = await attendanceDoc.get();

        if (!doc.exists || !doc.data().checkedIn) {
            // Check-in
            await attendanceDoc.set({
                entryTime: timestamp,
                exitTime: null,
                checkedIn: true
            }, { merge: true });

            return res.json({
                message: 'entered',
                name,
                time: timestamp
            });
        } else {
            // Check-out
            const entryTime = new Date(doc.data().entryTime);
            const exitTime = now;
            const periods = getPresentPeriods(entryTime, exitTime);

            await attendanceDoc.set({
                exitTime: timestamp,
                checkedIn: false,
                periods
            }, { merge: true });

            return res.json({
                message: 'exited',
                name,
                time: timestamp
            });
        }

    } catch (error) {
        return res.status(500).json({
            message: 'error',
            name: null,
            time: timestamp,
            errorDetails: error.message
        });
    }
});

// --- API: Register Student ---
app.post('/api/register', async (req, res) => {
    const { cardID, name, email, department, year, section } = req.body;
    if (!cardID || !name) {
        return res.status(400).json({ message: 'cardID and name are required' });
    }

    const userData = {
        name,
        email: email || null,
        department: department || null,
        year: year || null,
        section: section || null
    };

    await db.collection('Registered Students').doc(cardID).set(userData);
    res.json({ message: 'User registered successfully', cardID, ...userData });
});

// --- API: Who is currently present ---
app.get('/api/present', async (req, res) => {
    const dateKey = getTodayDateString();
    const snapshot = await db.collection('attendance').doc(dateKey).collection('records')
        .where('checkedIn', '==', true)
        .get();

    const users = [];
    for (const doc of snapshot.docs) {
        const userDoc = await db.collection('Registered Students').doc(doc.id).get();
        users.push({
            cardID: doc.id,
            name: userDoc.exists ? userDoc.data().name : 'Unknown',
            ...doc.data()
        });
    }

    res.json(users);
});

// --- API: All registered users ---
app.get('/api/registered', async (req, res) => {
    const snapshot = await db.collection('Registered Students').get();
    const users = snapshot.docs.map(doc => ({ cardID: doc.id, ...doc.data() }));
    res.json(users);
});

// --- API: Status of specific cardID ---
app.get('/api/status/:cardID', async (req, res) => {
    const { cardID } = req.params;
    const dateKey = getTodayDateString();
    const attendanceRef = db.collection('attendance').doc(dateKey).collection('records').doc(cardID);
    const attendanceDoc = await attendanceRef.get();
    const userDoc = await db.collection('Registered Students').doc(cardID).get();

    if (!userDoc.exists) {
        return res.status(404).json({ message: 'not registered' });
    }

    if (!attendanceDoc.exists) {
        return res.json({
            name: userDoc.data().name,
            status: 'Not checked in today'
        });
    }

    res.json({
        name: userDoc.data().name,
        ...attendanceDoc.data()
    });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
