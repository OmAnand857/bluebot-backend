import cron, { ScheduledTask } from "node-cron";
import dotenv from "dotenv";
import axios from "axios";
import db from "./firestore";
import { fetchDeepSearchTweetIdeas } from "./fetchTweets";
import { isUserLoggedIn } from "./refresh";
import { uploadImageToTwitterV1 } from "./twitterUpload";

dotenv.config();

interface Tweet {
  topic: string;
  tweet: string;
  hashtags: string[];
  image_url?: string | null;
}

interface ActiveUser {
  userName: string;
  lastPosted: number; // timestamp in ms
}

const POST_INTERVAL_HOURS = 8;
const POST_INTERVAL_MS = POST_INTERVAL_HOURS * 60 * 60 * 1000;

let activeUsers: ActiveUser[] = [];

export const tweetQueue: Tweet[] = [];
let cronTask: ScheduledTask | null = null;
let isCronRunning = false;


export function isUserTweeting( user_name : string ) : boolean {
    if(activeUsers.some( u => u.userName===user_name )) return true ;
    return false ;
}

export function startCronJob(userName: string) {
  if (!activeUsers.some(u => u.userName === userName)) {
    activeUsers.push({ userName, lastPosted: 0 });
  }

  if (isCronRunning) {
    return;
  }

  cronTask = cron.schedule("*/50 * * * *", async () => {

    for (const user of activeUsers) {
      const now = Date.now();
      const elapsed = now - user.lastPosted;

      if (elapsed < POST_INTERVAL_MS) {
        continue;
      }

      if (tweetQueue.length < 5) {
        try {
          const ideas = await fetchDeepSearchTweetIdeas();
          for (const topic in ideas) {
            for (const tweet of ideas[topic]) {
              tweetQueue.push({ topic, ...tweet });
            }
          }
        } catch (err) {
          console.error("[Cron] GPT fetch failed:", err);
          continue;
        }
      }

      const tweetsToPost = tweetQueue.splice(0, 5);
      await postTweetsSequentially(tweetsToPost, user.userName, user);
    }
  });

  cronTask.start();
  isCronRunning = true;
  console.log("[Cron] Job started.");
}

export function stopCronJob(userName: string) {
  activeUsers = activeUsers.filter(user => user.userName !== userName);
}

async function postTweetsSequentially(tweets: Tweet[], userName: string, userObj: ActiveUser) {
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    const success = await postToTwitter(tweet, userName);

    if (success && i === 0) {
      userObj.lastPosted = Date.now();
    }

    if (i < tweets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 2 minutes
    }
  }
}

async function postToTwitter(tweet: Tweet, userName: string): Promise<boolean> {
  const clientId = process.env.CLIENT_ID!;
  const valid = await isUserLoggedIn(userName, clientId);
  if (!valid) {
    console.error("[Auth] User not logged in.");
    return false;
  }

  const doc = await db.collection("users").doc(userName).get();
  const user = doc.data();
  if (!user) {
    console.error("No user data found");
    return false;
  }

  const { access_token, oauth_token, oauth_token_secret } = user;
  let mediaId: string | undefined;

  if (tweet.image_url) {
    try {
      mediaId = await uploadImageToTwitterV1(tweet.image_url, oauth_token, oauth_token_secret);
    } catch (err) {
      console.error("[Media] Upload failed:", err);
      return false;
    }
  } else {
    return false;
  }

  const body: any = {
    text: `${tweet.tweet} ${tweet.hashtags.join(" ")}`.trim(),
  };
  if (mediaId) body.media = { media_ids: [mediaId] };

  try {
    const res = await axios.post("https://api.twitter.com/2/tweets", body, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });
    console.log("[Post] Tweeted:", res.data);
    return true;
  } catch (err: any) {
    if (err.response?.status === 401) {
      console.error("[Post] Unauthorized: Access token expired.");
    }
    console.error("[Post] Failed:", err.response?.data || err.message);
    return false;
  }
}
