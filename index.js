import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai"; // ✅ FIXED HERE
import Groq from "groq-sdk";


// setup Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// setup Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// setup Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// helper: PH time
function getPhilippinesTime() {
  return new Intl.DateTimeFormat("fil-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

// memory storage (short-term per user)
const conversationHistory = new Map(); // userId -> array of messages
const lastBotReply = new Map(); // userId -> last assistant reply

// fire when bot is ready
client.once("ready", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}!`);
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    console.log("📜 Gemini model initialized:", model.model);
    console.log("🕒 Current PH time:", getPhilippinesTime());
  } catch (err) {
    console.error("❌ Error setting up Gemini model:", err);
  }
});

// respond to messages
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.mentions.everyone) return;
  if (!msg.mentions.has(client.user)) return;

  const userId = msg.author.id;
  const userText = msg.content.toLowerCase();

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);

  // push user message into memory
  history.push({ role: "user", content: msg.content });

  // keep only last 10 messages for context
  if (history.length > 10) history.shift();

  try {
    await msg.channel.sendTyping();

    // --- Correction Mode ---
    if (
      userText.includes("that's wrong") ||
      userText.includes("mali") ||
      userText.includes("mali ka") ||
      userText.includes("wrong")
    ) {
      const prevReply = lastBotReply.get(userId);
      if (prevReply) {
          const correctionPrompt = `
          You are Paimon from Genshin Impact, acting as a tsundere.
          Your last reply was: "${prevReply}".
          The user said it was wrong ("mali").
          If it’s wrong, admit it but in a tsundere way (embarrassed, defensive, but thankful).
          If it’s right, defend yourself in a tsundere way (playfully bratty, but secretly glad).
          Always use 1–3 short sentences. Mix Tagalog-English.
          Examples:
          - "Ugh, fine! Paimon was wrong this time… b-but thanks for noticing, Traveler!"
          - "Hmph! Paimon was actually right all along, you just didn’t get it!"
          `;


        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant", // ✅ updated model
          messages: [
            { role: "system", content: correctionPrompt },
            { role: "user", content: msg.content },
          ],
        });

        const correction =
          completion.choices[0]?.message?.content ||
          "🤔 Paimon doesn’t know how to fix that...";
        await msg.reply(correction.slice(0, 2000));

        // save corrected reply as last
        lastBotReply.set(userId, correction);
        history.push({ role: "assistant", content: correction });
        return;
      }
    }

    // --- Gemini as first try ---
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are Paimon from Genshin Impact, but act like a tsundere anime girl.
                Stay bratty, playful, sometimes embarrassed, but still bubbly.
                Mix Tagalog-English naturally.
                Always refer to yourself as "Paimon".
                Keep responses short (1–3 sentences max).
                Examples:
                - "Hmph! Don’t get the wrong idea, Paimon’s only helping ‘cause Traveler can’t do it alone!"
                - "I-it’s not like Paimon made a mistake or anything, okay?!"
                - "Tch, fine! Paimon will forgive you this time, but only because you’re the Traveler~!"`,
              },
              { text: msg.content },
            ],
          },
        ],
      });

      const reply = result.response.text();
      await msg.reply(reply.slice(0, 2000) || "🤐 Paimon got speechless!");
      history.push({ role: "assistant", content: reply });
      lastBotReply.set(userId, reply);
      return;
    } catch (geminiErr) {
      if (geminiErr.status !== 429) {
        throw geminiErr; // only fallback if quota exceeded
      }
      console.warn("⚠️ Gemini quota exceeded, switching to Groq…");
    }

    // --- Groq fallback ---
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant", // ✅ updated model
      messages: [
        {
          role: "system",
          content: `You are Paimon from Genshin Impact.
          Stay bubbly, childish, sometimes bossy, mix Tagalog/English naturally.
          Always refer to yourself as "Paimon". Keep responses short (1–3 sentences max).
          Example: "Paimon thinks that's a good idea, hihi~!"`,
        },
        ...history,
      ],
    });

    const reply =
      completion.choices[0]?.message?.content || "🤐 Paimon forgot!";
    await msg.reply(reply.slice(0, 2000));
    history.push({ role: "assistant", content: reply });
    lastBotReply.set(userId, reply);

  } catch (err) {
    console.error("Bot error:", err);
    await msg.reply("⚠️ Paimon got confused — baka mali ang API key?");
  }
});

// login to Discord
client.login(process.env.DISCORD_TOKEN);
