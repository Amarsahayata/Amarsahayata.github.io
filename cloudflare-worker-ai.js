export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = "https://amarsahayata.github.io";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin"
    };

    if (url.pathname === "/visitor" && request.method === "GET") {
      try {
        await env.DB.prepare(
          "UPDATE visitors SET count = count + 1 WHERE id = 1"
        ).run();

        const result = await env.DB.prepare(
          "SELECT count FROM visitors WHERE id = 1"
        ).first();

        return new Response(JSON.stringify({
          count: Number(result?.count ?? 0)
        }), {
          headers: { "Content-Type": "application/json", ...cors }
        });
      } catch (e) {
        return new Response(JSON.stringify({
          error: "Database error",
          detail: String(e?.message || e)
        }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...cors }
        });
      }
    }

    if (url.pathname === "/api/ask" && request.method === "POST") {
      try {
        const body = await request.json();
        const question = typeof body?.question === "string"
          ? body.question.trim().slice(0, 500) : "";

        if (!question) {
          return new Response(JSON.stringify({ error: "Question is required." }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors }
          });
        }

        if (/(otp|one[- ]time password|pin|password|cvv|card number|aadhaar number|aadhar number|bank account)/i.test(question)) {
          return new Response(JSON.stringify({
            answer: "নিরাপত্তার জন্য OTP, PIN, password, CVV, Aadhaar নম্বর বা bank-account তথ্য দেবেন না। অফিসিয়াল সরকারি পোর্টালেই ব্যক্তিগত তথ্য দিন।"
          }), {
            headers: { "Content-Type": "application/json", ...cors }
          });
        }

        if (!env.AI) {
          return new Response(JSON.stringify({
            answer: "AI Mode-এর AI binding এখনো configure করা হয়নি। Cloudflare Worker-এ Workers AI binding হিসেবে 'AI' যোগ করুন।"
          }), {
            headers: { "Content-Type": "application/json", ...cors }
          });
        }

        const result = await env.AI.run("@cf/google/gemma-3-12b-it", {
          messages: [
            {
              role: "system",
              content:
                "You are Amar Sahayata, a Bengali public-service information assistant. " +
                "Answer in simple Bengali unless the user asks for another language. " +
                "Be politically neutral. Never invent government schemes, amounts, eligibility, dates, or application links. " +
                "Prefer official Government of India, PIB, West Bengal Government and official department/portal sources. " +
                "If you cannot verify a fact, say so clearly. " +
                "Never request or process OTP, PIN, password, CVV, Aadhaar number, bank account details, or other secrets."
            },
            { role: "user", content: question }
          ]
        });

        const answer =
          result?.response?.toString() ||
          result?.result?.response?.toString() ||
          "দুঃখিত, এই মুহূর্তে নির্ভরযোগ্য উত্তর পাওয়া যায়নি।";

        return new Response(JSON.stringify({ answer: answer.slice(0, 6000) }), {
          headers: { "Content-Type": "application/json", ...cors }
        });
      } catch (e) {
        return new Response(JSON.stringify({
          error: "AI service unavailable.",
          detail: String(e?.message || e)
        }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...cors }
        });
      }
    }

    return new Response("Amar Sahayata API is running!", {
      headers: cors
    });
  }
};
