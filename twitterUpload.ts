import axios from "axios";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import FormData from "form-data"; // <--- required
import fs from "fs";

const consumerKey = process.env.CONSUMER_KEY!;
const consumerSecret = process.env.CONSUMER_SECRET!;

const oauth = new OAuth({
  consumer: { key: consumerKey, secret: consumerSecret },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

export async function uploadImageToTwitterV1(
  imageUrl: string, // URL or local path
  oauthToken: string,
  oauthTokenSecret: string
): Promise<string> {
  const imageRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(imageRes.data);

  const requestData = {
    url: "https://upload.twitter.com/1.1/media/upload.json",
    method: "POST",
  };

  const form = new FormData();
  form.append("media", buffer, { filename: "image.jpg" }); // match Postman

  const headers = {
    ...oauth.toHeader(
      oauth.authorize(requestData, {
        key: oauthToken,
        secret: oauthTokenSecret,
      })
    ),
    ...form.getHeaders(),
  };

  const uploadRes = await axios.post(requestData.url, form, {
    headers,
  });

  return uploadRes.data.media_id_string;
}
