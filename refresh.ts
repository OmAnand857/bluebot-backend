import axios from "axios";
import querystring from "querystring";
import db from "./firestore";

export async function refreshToken(refresh_token: string, client_id: string, user_name: string) {
  const data = querystring.stringify({
    refresh_token: refresh_token,
    grant_type: "refresh_token",
    client_id: client_id,
  });

  try {
    const response = await axios.post("https://api.x.com/2/oauth2/token", data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const access_token = response.data.access_token;
    const refresh_token = response.data.refresh_token;
    const expires_in = response.data.expires_in;
    const expires_at = Date.now() + expires_in * 1000

    await db.collection("users").doc(user_name).set({
      access_token: access_token,
      refresh_token: refresh_token,
      expires_at: expires_at
    },{merge:true})

  } catch (e: any) {
    console.error("Error refreshing token:", e.response?.data || e.message);
  }
}


export async function isUserLoggedIn(user_name: string, client_id: string) {
  const docRef = db.collection("users").doc(user_name);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return false;

  const data = docSnap.data();
  if (data == undefined) return false;
  const requiredFields = [
    "oauth_token",
    "oauth_token_secret",
    "access_token",
    "refresh_token",
    "expires_at"
  ];

  for (const field of requiredFields) {
    if (!data || !(field in data)) {
      return false;
    }
  }

  const now = Date.now();

  if (data.expires_at < now) {
    console.log("Access token expired, attempting refresh...");
    try {
      await refreshToken(data.refresh_token, client_id, user_name);
      return true;
    } catch (e) {
      console.error("Refresh failed:");
      return false;
    }
  }
  return true;
}
