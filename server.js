import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = process.env.ALLOWED_ORIGIN || "";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://pagead2.googlesyndication.com", "https://googleads.g.doubleclick.net"],
      imgSrc: ["'self'", "data:", "https://pagead2.googlesyndication.com", "https://googleads.g.doubleclick.net"],
      frameSrc: ["'self'", "https://googleads.g.doubleclick.net"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "20kb", strict: true }));

// CORS is deliberately restricted. If the browser is same-origin, no CORS is needed.
app.use((req, res, next) => {
  if (ORIGIN && req.headers.origin === ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Amar Sahayata", version: "2.0.0" });
});

app.post("/api/ask", apiLimiter, async (req, res) => {
  const question = typeof req.body?.question === "string"
    ? req.body.question.trim().slice(0, 500)
    : "";

  if (!question) return res.status(400).json({ error: "Question is required." });

  // Never send credentials or private form data to the model.
  const blocked = /(otp|one[- ]time password|pin|password|cvv|card number|aadhaar number|aadhar number|bank account)/i;
  if (blocked.test(question)) {
    return res.json({
      answer: "নিরাপত্তার জন্য OTP, PIN, password, CVV, Aadhaar নম্বর বা bank-account তথ্য দেবেন না। অফিসিয়াল সরকারি পোর্টালেই ব্যক্তিগত তথ্য দিন।"
    });
  }

  if (!process.env.AI_API_KEY || !process.env.AI_API_URL || !process.env.AI_MODEL) {
    return res.json({
      answer: "AI Mode চালু আছে। এই মুহূর্তে বাহ্যিক AI provider-এর key configure না থাকায় আমি শুধু সাইটে থাকা verified সরকারি তথ্যের ভিত্তিতে সাহায্য করতে পারি। নির্দিষ্ট স্কিম/সেবা/লিংকের নাম লিখুন—অফিসিয়াল উৎস যাচাই করার পরামর্শসহ সহজ ভাষায় তথ্য দেখানো হবে।"
    });
  }

  try {
    const response = await fetch(process.env.AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are Amar Sahayata, a Bengali public-service information assistant. " +
              "Be politically neutral. Never invent government schemes, amounts, eligibility, dates, or application links. " +
              "Prefer official Government of India, PIB, West Bengal Government and official department/portal sources. " +
              "If a fact cannot be verified from an official source, say that clearly. " +
              "Never request or process OTP, PIN, password, CVV, Aadhaar number, bank account details, or other secrets. " +
              "Keep answers simple for ordinary users and recommend checking the official source before applying."
          },
          { role: "user", content: question }
        ]
      })
    });

    if (!response.ok) {
      console.error("AI provider error:", response.status);
      return res.status(502).json({ error: "AI provider unavailable." });
    }

    const payload = await response.json();
    const answer =
      payload?.choices?.[0]?.message?.content?.toString().slice(0, 6000) ||
      payload?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("").slice(0, 6000) ||
      payload?.output_text?.toString().slice(0, 6000) ||
      "দুঃখিত, নির্ভরযোগ্য উত্তর পাওয়া যায়নি।";

    res.json({ answer });
  } catch (err) {
    console.error("AI request failed:", err.message);
    res.status(502).json({ error: "AI service unavailable." });
  }
});

// Static files are served only after the API routes.
app.use(express.static(__dirname, {
  extensions: ["html"],
  dotfiles: "deny",
  maxAge: "1h"
}));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => console.log(`Amar Sahayata listening on ${PORT}`));
