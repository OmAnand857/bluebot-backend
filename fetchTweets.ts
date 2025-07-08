import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const topics = [
  "cricket", "technology", "movies", "business", "geopolitics",
  "war", "space", "politics", "startup", "health", "environment"
];

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

function getRandomTopics(count: number): string[] {
  const shuffled = [...topics].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export async function fetchDeepSearchTweetIdeas(): Promise<Record<string, Tweet[]>> {
  const selectedTopics = getRandomTopics(5);
  const topicArticles: Record<string, Article[]> = {};

  for (const topic of selectedTopics) {
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
          item.title && item.description && item.image_url // ✅ require image_url
        )
        .slice(0, 1) // ✅ only 1 article per topic
        .map((item: any) => ({
          title: item.title,
          description: item.description,
          image_url: item.image_url,
        }));
    } catch (err: any) {
      console.error(`[NewsData.io] Failed for topic "${topic}":`);
      topicArticles[topic] = [];
    }
  }

const prompt = `
You are a helpful social media assistant.

For each article below, write a clear, complete, and engaging tweet under 280 characters. 
Ensure the tweet summarizes the core message of the article so the reader understands the full context without needing to read the original source. 
Avoid vague or incomplete statements. 
Aim to communicate as much useful information as possible in a concise and natural tone.

Include only 1 or 2 highly relevant hashtags, placed at the end. Do not use emojis in the hashtags.

Your output must be strictly valid JSON — no commentary, no formatting, no explanation.

Respond in the following format (example):

{
  "cricket": [
    {
      "tweet": "India seals a thrilling win against Australia in the final over, with Virat Kohli scoring an unbeaten 78 to chase down 187 in the T20 clash.",
      "hashtags": ["#INDvsAUS", "#T20"]
    }
  ],
  "technology": [
    {
      "tweet": "OpenAI has announced GPT-5, with significant improvements in reasoning, coding, and multilingual support. It will be available to developers later this year.",
      "hashtags": ["#AI", "#OpenAI"]
    }
  ],
  "space": [
    {
      "tweet": "NASA confirms that Voyager 1 is sending data again after months of silence, a huge success in deep space troubleshooting for a 46-year-old mission.",
      "hashtags": ["#NASA", "#Voyager1"]
    }
  ],
  "health": [
    {
      "tweet": "A new study finds that regular meditation can significantly reduce symptoms of anxiety and depression, even more effectively than some medications.",
      "hashtags": ["#MentalHealth"]
    }
  ],
  "business": [
    {
      "tweet": "Apple's market value crosses $3.5 trillion after strong Q2 results driven by record-breaking iPhone and services sales.",
      "hashtags": ["#Apple", "#StockMarket"]
    }
  ]
}

Here are the articles to summarize:
${selectedTopics.map(topic => {
  const articles = topicArticles[topic];
  if (!articles.length) return `\n${topic}: (No articles found)`;
  return `\n${topic}:\n` + articles.map(a =>
    `- Title: ${a.title}\n  Description: ${a.description}`
  ).join("\n");
}).join("\n")}
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
    const final: Record<string, Tweet[]> = {};
    for (const topic of selectedTopics) {
      const rawTweets = parsed[topic] || [];
      const articles = topicArticles[topic] || [];

      final[topic] = rawTweets.map((t: any, i: number) => ({
        tweet: typeof t.tweet === "string" ? t.tweet : "",
        hashtags: Array.isArray(t.hashtags) ? t.hashtags : [],
        image_url: articles[i]?.image_url || null,
      }));
    }
    return final;
  } catch (err: any) {
    console.error("[OpenRouter] Error generating tweets:");
    throw err;
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
