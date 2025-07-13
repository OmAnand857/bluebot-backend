import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const NEWS_API_KEY = process.env.NEWSDATA_API_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

interface Article {
  title: string;
  description: string;
  image_url: string | null;
}

interface Tweet {
  tweet: string;
  hashtags: string[];
  image_url?: string | null;
}

export async function fetchDeepSearchTweetIdeas(): Promise<Record<string, Tweet[]>> {
  const topic = "cricket";
  const topicArticles: Record<string, Article[]> = {};

  try {
    const res = await axios.get("https://newsdata.io/api/1/latest", {
      params: {
        apikey: NEWS_API_KEY,
        q: topic,
        language: "en",
      },
    });
    const results = res.data.results || [];

    topicArticles[topic] = results
      .filter((item: any) =>
        item.title && item.description && item.image_url
      )
      .slice(0, 5) // ✅ Fetch exactly 5 cricket articles
      .map((item: any) => ({
        title: item.title,
        description: item.description,
        image_url: item.image_url,
      }));
  } catch (err: any) {
    console.error(`[NewsData.io] Failed for topic "${topic}":`);
    topicArticles[topic] = [];
  }

  const prompt = `
You are a helpful social media assistant.

Write 5 clear, complete, and engaging tweets under 280 characters about the topic "cricket".
Each tweet should summarize the core message of one article so the reader understands the full context without needing to read the original source.

Avoid vague or incomplete statements.
Include 1 or 2 highly relevant hashtags at the end (no emojis).
Return strictly valid JSON like:

{
  "cricket": [
    {
      "tweet": "Text here",
      "hashtags": ["#tag1", "#tag2"]
    },
    ...
  ]
}

Articles:
${(topicArticles[topic] || []).map(a =>
  `- Title: ${a.title}\n  Description: ${a.description}`
).join("\n")}
`;

  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemma-3-27b-it:free",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://yourdomain.com",
        },
      }
    );

    let text = res.data.choices?.[0]?.message?.content || "";
    text = text.trim().replace(/```json|```/g, "").replace(/,\s*([\]}])/g, "$1");

    const parsed = JSON.parse(text);
    const rawTweets = parsed[topic] || [];
    const articles = topicArticles[topic] || [];

    const final: Record<string, Tweet[]> = {
      [topic]: rawTweets.map((t: any, i: number) => ({
        tweet: t.tweet || "",
        hashtags: t.hashtags || [],
        image_url: articles[i]?.image_url || null,
      })),
    };

    return final;
  } catch (err: any) {
    console.error("[OpenRouter] Error generating tweets:");
    throw err;
  }
}
