import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";

// Load service account from env var
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

// Initialize Firebase only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://deltamind-7ac57-default-rtdb.firebaseio.com",
  });
}

const db = admin.database();
const genAI = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  try {
    const { machineID, data } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    const sessionRef = db.ref(`machineLogs/${machineID}/${today}`);
    
    // Ensure session exists
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists()) {
      await sessionRef.set({
        startTime: new Date().toISOString(),
        logs: {},
      });
    }
    
    // Add the log
    const logsRef = sessionRef.child("logs");
    await logsRef.push({ ...data, timestamp: Date.now() });
    
    // Check how many logs we’ve got
    const allLogsSnap = await logsRef.get();
    const logs = allLogsSnap.val() || {};
    const logCount = Object.keys(logs).length;
    
    // If enough logs, and no summary yet, call Gemini
    const session = sessionSnap.val() || {};
    if (logCount >= 4 && !session.summary) {
      const logsArray = Object.values(logs);
      const avgTemp =
        logsArray.reduce((a, b) => a + b.temp, 0) / logsArray.length;
      const avgHum =
        logsArray.reduce((a, b) => a + b.hum, 0) / logsArray.length;
      
      const prompt = `Summarize these environment readings:
        Average Temperature: ${avgTemp.toFixed(1)}°C
        Average Humidity: ${avgHum.toFixed(1)}%.`;
      
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const summary = result.response.text();
      
      await sessionRef.update({ summary });
    }
    
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}