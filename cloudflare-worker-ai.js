/**
 * Amar Sahayata - Cloudflare Worker
 * FINAL FIXED: AI + Visitor Counter + Multimodal AI Studio
 *
 * Existing routes preserved:
 *   GET  /visitor
 *   POST /api/ask
 *
 * AI Studio routes:
 *   POST /api/vision
 *   POST /api/file
 *   POST /api/image
 *   POST /api/edit-image
 *   POST /api/search
 *   POST /api/video
 *
 * Required bindings:
 *   Workers AI  -> AI
 *   D1 Database -> DB
 *
 * AI Gateway:
 *   Gateway ID: default
 */

const GATEWAY_ID = "default";

async function aiRun(env, model, input, options = {}) {
  return env.AI.run(model, input, {
    ...options,
    gateway: {
      id: GATEWAY_ID,
      ...(options.gateway || {}),
    },
  });
}
const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const SEARCH_MODEL = "openai/gpt-5-mini";
const VIDEO_MODEL = "runwayml/gen-4.5";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://amarsahayata.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    const json = (data, status = 200, extra = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
          ...extra,
        },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // -------------------------------------------------
    // Helpers
    // -------------------------------------------------
    function errorInfo(error) {
      const message = String(error?.message || error || "Unknown error");
      const status = Number(error?.status || error?.statusCode || 0) || 0;
      const codeMatch = message.match(/(?:code|error code|internal code)\D{0,12}(\d{4})/i);
      const code = codeMatch ? codeMatch[1] : "";
      return { message, status, code };
    }

    function friendlyAIError(error, feature = "AI") {
      const e = errorInfo(error);
      if (e.code === "3036" || e.status === 429 && /daily free allocation|10,000 neurons/i.test(e.message)) {
        return `${feature} আজকের Cloudflare AI free limit-এ পৌঁছে গেছে। Limit UTC midnight-এ reset হয়।`;
      }
      if (e.code === "3040" || e.status === 429) {
        return `${feature} এই মুহূর্তে Cloudflare capacity সমস্যার কারণে সাময়িকভাবে ব্যর্থ হয়েছে। কয়েক সেকেন্ড পরে আবার চেষ্টা করুন।`;
      }
      if (e.code === "5035") {
        return `${feature} model-এর জন্য Cloudflare Workers Paid plan বা prepaid AI Gateway credits প্রয়োজন।`;
      }
      if (e.code === "5007" || e.code === "3042") {
        return `${feature} modelটি Cloudflare account-এ পাওয়া যাচ্ছে না। Worker code/model configuration পরীক্ষা করতে হবে।`;
      }
      if (e.code === "3007" || e.status === 408) {
        return `${feature} request timeout হয়েছে। ছোট prompt/image দিয়ে আবার চেষ্টা করুন।`;
      }
      if (e.code === "3006" || e.status === 413) {
        return `${feature} request/file খুব বড়। ছোট file বা image ব্যবহার করুন।`;
      }
      if (e.status === 401 || e.status === 403) {
        return `${feature} access/authentication configuration সম্পূর্ণ হয়নি। Cloudflare AI/Gateway settings পরীক্ষা করুন।`;
      }
      return `${feature} সাময়িকভাবে কাজ করছে না। Cloudflare Worker Logs-এ আসল error দেখা যাবে।`;
    }

    async function runText(question, thinking = false) {
      const options = {
        messages: [
          {
            role: "system",
            content:
              "You are Amar Sahayata AI Assistant. Answer clearly, helpfully and politely. " +
              "Use Bengali, English or mixed Bengali-English according to the user. " +
              "For government services and factual claims, do not invent official facts or links. " +
              "Never request OTP, PIN, password, CVV, Aadhaar number, bank account number or other sensitive personal information. " +
              "When code is requested, provide complete code when it fits. Preserve syntax, tags, braces and closing sections. " +
              "Never claim that code was tested unless it was actually tested. " +
              (thinking
                ? "Use careful internal reasoning and give a concise useful answer; never reveal private chain-of-thought."
                : "Keep the answer practical, concise and readable."),
          },
          { role: "user", content: question },
        ],
        chat_template_kwargs: { enable_thinking: Boolean(thinking) },
        // Kept deliberately moderate to reduce unnecessary daily AI usage.
        max_tokens: thinking ? 2048 : 1536,
      };

      try {
        return await aiRun(env, TEXT_MODEL, options);
      } catch (firstError) {
        const first = errorInfo(firstError);
        // A single retry helps with transient 3040/out-of-capacity errors.
        if (first.code === "3040" || first.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 350));
          return await aiRun(env, TEXT_MODEL, options);
        }
        throw firstError;
      }
    }

    function extractText(result) {
      return (
        result?.choices?.[0]?.message?.content ||
        result?.output_text ||
        result?.response ||
        result?.result?.response ||
        result?.text ||
        result?.result?.text ||
        ""
      );
    }

    // -------------------------------------------------
    // VISITOR COUNTER - preserved
    // -------------------------------------------------
    if (url.pathname === "/visitor") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
      }
      try {
        await env.DB.prepare("UPDATE visitors SET count = count + 1 WHERE id = 1").run();
        const result = await env.DB.prepare("SELECT count FROM visitors WHERE id = 1").first();
        return json({ count: result?.count ?? 0 });
      } catch (error) {
        return json({ error: "Database error" }, 500);
      }
    }

    // -------------------------------------------------
    // NORMAL AI ANSWER
    // -------------------------------------------------
    if (url.pathname === "/api/ask") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question =
          typeof body?.question === "string" ? body.question.trim() :
          typeof body?.message === "string" ? body.message.trim() :
          typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!question) return json({ error: "Please enter a question." }, 400);

        const result = await runText(question, Boolean(body?.thinking));
        const answer = extractText(result);
        if (!answer) return json({ error: "AI did not return a readable answer." }, 502);
        return json({ answer });
      } catch (error) {
        return json({ error: friendlyAIError(error, "AI Mode") }, 503);
      }
    }

    // -------------------------------------------------
    // IMAGE UNDERSTANDING
    // -------------------------------------------------
    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question = typeof body?.question === "string" ? body.question.trim() : "Describe and help with this image.";
        const image = typeof body?.image === "string" ? body.image : "";
        if (!image.startsWith("data:image/")) return json({ error: "A valid image is required." }, 400);
        if (image.length > 16_000_000) return json({ error: "Image is too large. Please use a smaller photo." }, 413);

        const result = await aiRun(env, TEXT_MODEL, {
          messages: [
            {
              role: "system",
              content:
                "You are Amar Sahayata AI Assistant. Analyze the supplied image and answer the user's request. " +
                "Use Bengali, English or mixed language according to the prompt. Never invent details that are not visible. " +
                "Do not request sensitive personal information.",
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: image } },
                { type: "text", text: question },
              ],
            },
          ],
          chat_template_kwargs: { enable_thinking: Boolean(body?.thinking) },
          max_tokens: body?.thinking ? 2048 : 1536,
        });

        const answer = extractText(result);
        if (!answer) return json({ error: "AI could not analyze this image." }, 502);
        return json({ answer });
      } catch (error) {
        return json({ error: friendlyAIError(error, "Image analysis") }, 503);
      }
    }

    // -------------------------------------------------
    // FILE UNDERSTANDING
    // -------------------------------------------------
    if (url.pathname === "/api/file") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const form = await request.formData();
        const file = form.get("file");
        const question = String(form.get("question") || "Analyze this file and answer the user's request.").trim();
        const thinking = String(form.get("thinking") || "0") === "1";
        if (!(file instanceof File)) return json({ error: "Please attach a file." }, 400);
        if (file.size > 12 * 1024 * 1024) return json({ error: "File is too large. Maximum 12 MB." }, 413);

        const converted = await env.AI.toMarkdown(
          { name: file.name || "attachment", blob: file },
          { conversionOptions: { output: { format: "text" } } }
        );
        const item = Array.isArray(converted) ? converted[0] : converted;
        if (!item || item.format === "error") {
          return json({ error: item?.error || "File conversion failed." }, 422);
        }

        const text = String(item.data || "");
        const trimmed = text.slice(0, 120000);
        const result = await runText(
          "The user attached a file named '" + file.name + "'.\n\nFILE CONTENT:\n" +
            trimmed + "\n\nUSER REQUEST:\n" + question,
          thinking
        );
        const answer = extractText(result);
        if (!answer) return json({ error: "AI did not return a readable answer." }, 502);
        return json({ answer, filename: file.name });
      } catch (error) {
        return json({ error: friendlyAIError(error, "File analysis") }, 503);
      }
    }

    // -------------------------------------------------
    // IMAGE EDITING - FLUX.2 klein 4B
    // -------------------------------------------------
    if (url.pathname === "/api/edit-image") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        const image = typeof body?.image === "string" ? body.image : "";
        if (!prompt) return json({ error: "Please enter an image-edit prompt." }, 400);
        if (!image.startsWith("data:image/")) return json({ error: "A valid image is required." }, 400);
        if (image.length > 8_000_000) return json({ error: "Image is too large. Please use a smaller photo." }, 413);

        const match = image.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s);
        if (!match) return json({ error: "Invalid image data." }, 400);
        const ext = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
        const mime = `image/${ext}`;
        const binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("input_image_0", new Blob([binary], { type: mime }), `input-image.${ext}`);
        form.append("width", "1024");
        form.append("height", "1024");

        const formRequest = new Request("https://dummy.invalid", { method: "POST", body: form });
        const result = await aiRun(env, EDIT_MODEL, {
          multipart: {
            body: formRequest.body,
            contentType: formRequest.headers.get("content-type") || "multipart/form-data",
          },
        });

        if (!result?.image) return json({ error: "Image editing failed." }, 502);
        return json({
          dataURI: `data:image/jpeg;base64,${result.image}`,
          answer: "ছবিটি আপনার prompt অনুযায়ী edit করা হয়েছে।",
        });
      } catch (error) {
        return json({ error: friendlyAIError(error, "Image editing") }, 503);
      }
    }

    // -------------------------------------------------
    // TEXT TO IMAGE
    // -------------------------------------------------
    if (url.pathname === "/api/image") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return json({ error: "Please enter an image prompt." }, 400);
        if (prompt.length > 2048) return json({ error: "Image prompt is too long." }, 400);

        const result = await aiRun(env, IMAGE_MODEL, {
          prompt,
          steps: 4,
          seed: Math.floor(Math.random() * 2147483647),
        });
        if (!result?.image) return json({ error: "Image generation failed." }, 502);
        return json({ dataURI: `data:image/jpeg;base64,${result.image}` });
      } catch (error) {
        return json({ error: friendlyAIError(error, "Image generation") }, 503);
      }
    }

    // -------------------------------------------------
    // WEB SEARCH - AI Gateway / OpenAI Responses API
    // -------------------------------------------------
    if (url.pathname === "/api/search") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question = typeof body?.question === "string" ? body.question.trim() : "";
        if (!question) return json({ error: "Please enter a search question." }, 400);
        if (question.length > 8000) return json({ error: "Search question is too long." }, 400);

        const result = await aiRun(env, SEARCH_MODEL,
          {
            input:
              "Search the web for the user's question. Answer in the same language as the user. " +
              "Prefer authoritative and current sources. Do not invent facts. Keep the answer useful and concise.\n\n" +
              "User question: " + question,
            max_output_tokens: 2048,
            tools: [{ type: "web_search_preview" }],
          }
        );

        const answer = extractText(result);
        if (!answer) return json({ error: "Web search did not return a readable answer." }, 502);
        return json({ answer });
      } catch (error) {
        const e = errorInfo(error);
        if (e.status === 401 || e.status === 403) {
          return json({
            error:
              "Web Search-এর জন্য AI Gateway 'default' এবং OpenAI provider authentication/credits সম্পূর্ণ করতে হবে।",
          }, 503);
        }
        return json({ error: friendlyAIError(error, "Web Search") }, 503);
      }
    }

    // -------------------------------------------------
    // SHORT VIDEO - Runway Gen-4.5 through AI Gateway
    // -------------------------------------------------
    if (url.pathname === "/api/video") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return json({ error: "Please enter a video prompt." }, 400);
        if (prompt.length > 1000) return json({ error: "Video prompt is too long." }, 400);

        const input = {
          prompt,
          duration: 5,
          ratio: "1280:720",
        };
        if (typeof body?.image === "string" && body.image.startsWith("data:image/")) {
          input.image_input = body.image;
        }

        const result = await aiRun(env, VIDEO_MODEL, input);
        const video = result?.result?.video || result?.video;
        if (!video) return json({ error: "Video generation did not return a video." }, 502);
        return json({ video, answer: "Short video তৈরি হয়েছে।" });
      } catch (error) {
        const e = errorInfo(error);
        if (e.status === 401 || e.status === 403) {
          return json({
            error:
              "Short Video-এর জন্য Runway Gen-4.5 access এবং Cloudflare AI Gateway billing/credits configuration প্রয়োজন।",
          }, 503);
        }
        return json({ error: friendlyAIError(error, "Short Video") }, 503);
      }
    }

    return new Response("Amar Sahayata API is running!", { headers: corsHeaders });
  },
};
