import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawKey) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env variable");
}
const filePath = "./dist/serviceAccountKey.json";
fs.writeFileSync(filePath, rawKey, { encoding: "utf8" });
