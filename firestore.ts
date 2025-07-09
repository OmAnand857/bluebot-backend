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

export default db ;