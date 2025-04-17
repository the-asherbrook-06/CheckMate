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

// --- RFID Endpoint ---
app.post('/api/rfid', async (req, res) => {
    const { cardID } = req.body;
    if (!cardID) return res.status(400).json({ message: 'cardID is required' });

    const studentRef = db.collection('registered_students').doc(cardID);
    const studentDoc = await studentRef.get();

    if (!studentDoc.exists) {
        return res.status(404).json({ message: 'not registered', cardID });
    }

    const studentData = studentDoc.data();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayRef = db.collection('attendance').doc(today).collection('records').doc(cardID);
    const todayDoc = await todayRef.get();

    const timestamp = admin.firestore.Timestamp.fromDate(now);

    if (!todayDoc.exists || !todayDoc.data().checkedIn) {
        // Entry
        const periodsData = {};
        for (const period of Object.keys(PERIODS)) {
            periodsData[period] = {
                duration: 0,
                present: false
            };
        }

        await todayRef.set({
            checkedIn: true,
            entryTime: timestamp,
            periods: periodsData
        }, { merge: true });

        return res.json({ message: 'entered', name: studentData.name, time: timestamp });
    } else {
        // Exit
        const entryTime = todayDoc.data().entryTime.toDate();
        const periodsToUpdate = {};

        for (const [period, [start, end]] of Object.entries(PERIODS)) {
            const [startHour, startMinute] = start.split(':').map(Number);
            const [endHour, endMinute] = end.split(':').map(Number);

            // ⏰ Use entryTime's date to anchor period times
            const periodStart = new Date(entryTime);
            periodStart.setHours(startHour, startMinute, 0, 0);

            const periodEnd = new Date(entryTime);
            periodEnd.setHours(endHour, endMinute, 0, 0);

            // 🚫 Skip periods that ended before entry
            if (periodEnd <= entryTime) continue;

            const overlapStart = Math.max(entryTime.getTime(), periodStart.getTime());
            const overlapEnd = Math.min(now.getTime(), periodEnd.getTime());

            if (overlapEnd > overlapStart) {
                const overlapMinutes = Math.floor((overlapEnd - overlapStart) / 60000);
                const prev = todayDoc.data().periods?.[period] || { duration: 0, present: false };

                periodsToUpdate[`periods.${period}`] = {
                    duration: prev.duration + overlapMinutes,
                    present: true
                };
            }
        }

        await todayRef.update({
            checkedIn: false,
            exitTime: timestamp,
            ...periodsToUpdate
        });

        return res.json({ message: 'exited', name: studentData.name, time: timestamp });
    }
});

app.get('/api/time-diff', (req, res) => {
    const now = new Date();
    const offset = now.getTimezoneOffset();  // Offset in minutes from UTC (e.g., +330 for IST)

    res.json({
        serverTime: now.toISOString(),  // Current server time in ISO format
        utcOffset: offset  // UTC offset in minutes
    });
});


// --- Server Listen ---
app.listen(PORT, () => {
    console.log(`🎉 Server is running on http://localhost:${PORT}`);
});
