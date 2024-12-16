import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
bot.setWebHook(process.env.SERVER_URL + bot.token);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post(`/${process.env.TELEGRAM_TOKEN}`, express.json(), (req, res) => {
  bot.processUpdate(req.body);
  res.status(200).json({ message: "ok" });
});

const conversationState = new Map();

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim().toLowerCase();

  try {
    let conversation = await prisma.conversation.findUnique({
      where: { userId: chatId.toString() },
      include: { messages: true },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId: chatId.toString() },
      });
    }

    const state = conversationState.get(chatId) || "start";
    let botReply;

    switch (state) {
      case "start":
        botReply = "Hi there! Are you looking for a health insurance plan?";
        conversationState.set(chatId, "asking_family_size");
        break;
      case "asking_family_size":
        if (text.includes("yes")) {
          botReply = "Great! Let's start. What's your family size?";
          conversationState.set(chatId, "asking_income");
        } else {
          botReply = "Alright, feel free to ask me anything else!";
          conversationState.delete(chatId);
        }
        break;
      case "asking_income":
        if (text.match(/^\d+$/)) {
          botReply = "Thanks! What's your household income?";
          conversationState.set(chatId, "asking_gender");
        } else {
          botReply = "Could you please provide your family size in numbers?";
        }
        break;
      case "asking_gender":
        if (text.match(/^\d+$/)) {
          botReply =
            "Got it! Lastly, can you share your gender (male/female/other)?";
          conversationState.set(chatId, "complete");
        } else {
          botReply = "Please provide your household income in numbers.";
        }
        break;
      case "complete":
        if (["male", "female", "other"].includes(text)) {
          botReply =
            "Thank you for providing the information! We'll get back to you with the best insurance plans.";
          conversationState.delete(chatId);
        } else {
          botReply = "Please specify your gender as male, female, or other.";
        }
        break;
      default:
        const res = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: text },
          ],
        });
        botReply =
          res.choices[0]?.message?.content || "I'm here to assist you!";
        break;
    }

    await prisma.message.createMany({
      data: [
        { role: "user", content: text, convoId: conversation.id },
        { role: "bot", content: botReply, convoId: conversation.id },
      ],
    });

    bot.sendMessage(chatId, botReply);
  } catch (err) {
    console.error("Error:", err);
    bot.sendMessage(chatId, "Something went wrong. Please try again later.");
  }

  bot.on("polling_error", (error) => {
    console.error("Polling error:", error);
  });
});
