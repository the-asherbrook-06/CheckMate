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

// --- Periods --- (times are in IST, we will convert them to UTC)
const PERIODS = {
    Hour1: ['08:40', '09:40'],  // IST times
    Hour2: ['09:40', '10:40'],
    Break: ['10:40', '11:00'],
    Hour3: ['11:00', '12:00'],
    Hour4: ['12:00', '13:00'],
    Lunch: ['13:00', '13:40'],
    Hour5: ['13:40', '14:30'],
    Hour6: ['14:30', '15:20'],
    Hour7: ['15:20', '16:10']
};

// Helper function to convert IST to UTC (subtract 5 hours 30 minutes)
function convertISTToUTC(hours, minutes) {
    const date = new Date();
    // Set the date to 1970-01-01 to focus only on the time part
    date.setFullYear(1970, 0, 1);  
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(0);
    date.setMilliseconds(0);

    // Subtract 5 hours and 30 minutes to convert from IST to UTC
    date.setHours(date.getHours() - 5);
    date.setMinutes(date.getMinutes() - 30);

    return date;
}

// Helper function to get UTC date for the specific period time
function getUTCDate(date, hours, minutes) {
    const utcDate = new Date(date.getTime());
    const periodTime = convertISTToUTC(hours, minutes);

    utcDate.setUTCHours(periodTime.getHours(), periodTime.getMinutes(), 0, 0);
    return utcDate;
}

// --- API Endpoint ---
app.post('/api/rfid', async (req, res) => {
    const { cardID } = req.body;
    if (!cardID) return res.status(400).json({ message: 'cardID is required' });

    const studentRef = db.collection('registered_students').doc(cardID);
    const studentDoc = await studentRef.get();

    if (!studentDoc.exists) {
        return res.status(404).json({ message: 'not registered', cardID });
    }

    const studentData = studentDoc.data();
    const now = new Date(); // UTC
    const today = now.toISOString().split('T')[0];
    const todayRef = db.collection('attendance').doc(today).collection('records').doc(cardID);
    const todayDoc = await todayRef.get();

    const timestamp = admin.firestore.Timestamp.fromDate(now);

    if (!todayDoc.exists) {
        // First ever entry for the day
        const periodsData = {};
        for (const period of Object.keys(PERIODS)) {
            periodsData[period] = {
                duration: 0,
                present: false
            };
        }

        await todayRef.set({
            rollNumber: studentData.rollNumber,
            dept: studentData.dept,
            classroom: studentData.classroom,
            checkedIn: true,
            entryTime: timestamp,
            periods: periodsData
        });        

        return res.json({ message: 'entered', name: studentData.name, time: timestamp });
    }

    const todayData = todayDoc.data();

    if (!todayData.checkedIn) {
        // Re-entry: don't overwrite periods, just update checkedIn and entryTime
        await todayRef.update({
            checkedIn: true,
            entryTime: timestamp
        });

        return res.json({ message: 'entered', name: studentData.name, time: timestamp });
    } else {
        // Exit logic
        const entryTime = todayData.entryTime.toDate(); // UTC
        const periodsToUpdate = {};

        for (const [period, [start, end]] of Object.entries(PERIODS)) {
            const [startHour, startMinute] = start.split(':').map(Number);
            const [endHour, endMinute] = end.split(':').map(Number);

            const periodStart = new Date(entryTime);
            periodStart.setUTCHours(startHour - 5, startMinute - 30, 0, 0); // Convert IST to UTC

            const periodEnd = new Date(entryTime);
            periodEnd.setUTCHours(endHour - 5, endMinute - 30, 0, 0); // Convert IST to UTC

            if (periodEnd <= entryTime) continue;

            const overlapStart = Math.max(entryTime.getTime(), periodStart.getTime());
            const overlapEnd = Math.min(now.getTime(), periodEnd.getTime());

            if (overlapEnd > overlapStart) {
                const overlapMinutes = Math.floor((overlapEnd - overlapStart) / 60000);
                const prev = todayData.periods?.[period] || { duration: 0, present: false };
                const updatedDuration = prev.duration + overlapMinutes;

                periodsToUpdate[`periods.${period}`] = {
                    duration: updatedDuration,
                    present: updatedDuration >= 10
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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
