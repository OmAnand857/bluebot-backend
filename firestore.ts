import admin from "firebase-admin";
const serviceAccount = require("../serviceAccountKey.json");

interface userData {
    oauth_token : string,
    oauth_token_secret : string,
    access_token : string ,
    refresh_token : string ,
    expires_at : string ,
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

try {
  // Optional: Test a simple DB call to verify connection
  db.collection("healthcheck").doc("init").set({ timestamp: Date.now() }, { merge: true })
    .then(() => {
      console.log("✅ Firestore write test succeeded.");
    })
    .catch((err) => {
      console.error("❌ Firestore write test failed:", err.message);
    });

} catch (err) {
  console.error("❌ Failed to initialize Firebase admin:", (err as Error).message);
}


export default db ;