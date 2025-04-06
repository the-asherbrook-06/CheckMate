const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase Init
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

// --- Periods ---
const PERIODS = {
    Hour1: ['08:40', '09:40'],
    Hour2: ['09:40', '10:40'],
    Break: ['10:40', '11:00'],
    Hour3: ['11:00', '12:00'],
    Hour4: ['12:00', '13:00'],
    Lunch: ['13:00', '13:40'],
    Hour5: ['13:40', '14:30'],
    Hour6: ['14:30', '15:20'],
    Hour7: ['15:20', '16:10']
};

// --- Helpers ---
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

function parseTime(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}

function getMinutesSinceMidnight(date = new Date()) {
    const localDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return localDate.getHours() * 60 + localDate.getMinutes();
}

// Get attended periods with duration ≥ 10%
function getPresentPeriods(entryDate, exitDate) {
    const entryMin = getMinutesSinceMidnight(entryDate);
    const exitMin = getMinutesSinceMidnight(exitDate);
    const results = {};

    for (const [period, [start, end]] of Object.entries(PERIODS)) {
        const startMin = parseTime(start);
        const endMin = parseTime(end);
        const periodDuration = endMin - startMin;

        const overlapStart = Math.max(entryMin, startMin);
        const overlapEnd = Math.min(exitMin, endMin);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if ((overlap / periodDuration) * 100 >= 10) {
            results[period] = { present: true, duration: overlap };
        }
    }

    return results;
}

// --- API: RFID Scan ---
app.post('/api/rfid', async (req, res) => {
    const { cardID } = req.body;
    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = getTodayDateString();

    if (!cardID) return res.status(400).json({ message: 'Invalid request: cardID is required' });

    try {
        const userRef = db.collection('Registered Students').doc(cardID);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'not registered', cardID });
        }

        const user = userDoc.data();
        const name = user.name || 'Unknown';

        const recordRef = db.collection('attendance').doc(dateKey).collection('records').doc(cardID);
        const recordDoc = await recordRef.get();

        if (!recordDoc.exists || !recordDoc.data().checkedIn) {
            await recordRef.set({
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
            const entryTime = new Date(recordDoc.data().entryTime);
            const exitTime = now;

            const newPeriods = getPresentPeriods(entryTime, exitTime);
            const existing = recordDoc.data().periods || {};
            const mergedPeriods = { ...existing };

            for (const period of Object.keys(newPeriods)) {
                if (mergedPeriods[period]) {
                    mergedPeriods[period].duration += newPeriods[period].duration;
                } else {
                    mergedPeriods[period] = newPeriods[period];
                }
            }

            await recordRef.set({
                exitTime: timestamp,
                checkedIn: false,
                periods: mergedPeriods
            }, { merge: true });

            return res.json({
                message: 'exited',
                name,
                time: timestamp
            });
        }

    } catch (err) {
        return res.status(500).json({
            message: 'error',
            name: null,
            time: new Date().toISOString(),
            errorDetails: err.message
        });
    }
});

// --- API: Register Student ---
app.post('/api/register', async (req, res) => {
    const { cardID, name, email, department, year, section } = req.body;

    if (!cardID || !name) {
        return res.status(400).json({ message: 'cardID and name are required' });
    }

    // Replace undefined values with empty strings
    const data = {
        name: name || "",
        email: email || "",
        department: department || "",
        year: year || "",
        section: section || ""
    };

    await db.collection('Registered Students').doc(cardID).set(data);
    res.json({ message: 'User registered successfully', cardID, ...data });
});


// --- API: Get Present Students ---
app.get('/api/present', async (req, res) => {
    const dateKey = getTodayDateString();
    const snap = await db.collection('attendance').doc(dateKey).collection('records')
        .where('checkedIn', '==', true).get();

    const result = [];

    for (const doc of snap.docs) {
        const cardID = doc.id;
        const userDoc = await db.collection('Registered Students').doc(cardID).get();
        const name = userDoc.exists ? userDoc.data().name : 'Unknown';
        result.push({ cardID, name, ...doc.data() });
    }

    res.json(result);
});

// --- API: Get All Registered Users ---
app.get('/api/registered', async (req, res) => {
    const snap = await db.collection('Registered Students').get();
    const users = snap.docs.map(doc => ({ cardID: doc.id, ...doc.data() }));
    res.json(users);
});

// --- API: Status by cardID ---
app.get('/api/status/:cardID', async (req, res) => {
    const { cardID } = req.params;
    const dateKey = getTodayDateString();

    const userDoc = await db.collection('Registered Students').doc(cardID).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'not registered' });

    const attendanceDoc = await db.collection('attendance').doc(dateKey).collection('records').doc(cardID).get();
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
    console.log(`Server running at http://localhost:${PORT}`);
});
