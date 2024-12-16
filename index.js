import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: process.env.NODE_ENV !== "production",
});

if (process.env.NODE_ENV === "production") {
  bot.setWebHook(process.env.SERVER_URL + process.env.TELEGRAM_TOKEN);

  app.post(`/${process.env.TELEGRAM_TOKEN}`, express.json(), (req, res) => {
    console.log("Webhook received:", req.body);

    try {
      bot.processUpdate(req.body);
      console.log("Update processed successfully");
      res.status(200).json({ message: "ok" });
    } catch (err) {
      console.error("Error processing update:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });
} else {
  console.log("Bot is running in development mode with polling.");
}

const conversationState = new Map();

bot.on("message", async (msg) => {
  console.log("Message received:", msg.text);
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
        await bot.sendMessage(chatId, botReply);
        return;

      case "asking_family_size":
        if (text.includes("yes")) {
          botReply = "Great! Let's start. What's your family size?";
          conversationState.set(chatId, "asking_income");
        } else {
          botReply = "Alright, feel free to ask me anything else!";
          conversationState.delete(chatId);
        }
        await bot.sendMessage(chatId, botReply);
        return;

      case "asking_income":
        if (text.match(/^\d+$/)) {
          botReply = "Thanks! What's your household income?";
          conversationState.set(chatId, "asking_gender");
        } else {
          botReply = "Could you please provide your family size in numbers?";
        }
        await bot.sendMessage(chatId, botReply);
        return;

      case "asking_gender":
        if (text.match(/^\d+$/)) {
          botReply =
            "Got it! Lastly, can you share your gender (male/female/other)?";
          conversationState.set(chatId, "complete");
        } else {
          botReply = "Please provide your household income in numbers.";
        }
        await bot.sendMessage(chatId, botReply);
        return;

      case "complete":
        if (["male", "female", "other"].includes(text)) {
          botReply =
            "Thank you for providing the information! We'll get back to you with the best insurance plans.";
          conversationState.delete(chatId);
        } else {
          botReply = "Please specify your gender as male, female, or other.";
        }
        await bot.sendMessage(chatId, botReply);
        return;

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
        conversationState.delete(chatId); // Reset state for unrelated queries
        await bot.sendMessage(chatId, botReply);
        return;
    }
  } catch (err) {
    console.error("Error:", err);
    await bot.sendMessage(
      chatId,
      "Something went wrong. Please try again later."
    );
    return;
  }
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});
