/**
 * Amar Sahayata - Cloudflare Worker
 * Final AI + Visitor Counter + Multimodal AI Studio
 *
 * Existing routes preserved:
 *   GET  /visitor
 *   POST /api/ask
 * Added routes:
 *   POST /api/vision   -> image understanding with Gemma 4 Vision
 *   POST /api/file     -> PDF/Office/image/etc. to Markdown + AI answer
 *   POST /api/image    -> text-to-image with FLUX.1 schnell
 *   POST /api/video    -> text/image-to-video with Runway Gen-4.5
 *   POST /api/search   -> web-grounded answer through AI Gateway
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://amarsahayata.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

    // =====================================
    // VISITOR COUNTER - unchanged
    // =====================================
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

    // =====================================
    // Shared text-generation helper
    // =====================================
    async function textAnswer(question, thinking = false) {
      const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
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
                ? "Use careful reasoning internally and give a concise useful explanation or plan; do not reveal private chain-of-thought."
                : "Keep the answer practical and readable."),
          },
          { role: "user", content: question },
        ],
        chat_template_kwargs: { enable_thinking: Boolean(thinking) },
        max_tokens: 4096,
      });
      return (
        result?.choices?.[0]?.message?.content ||
        result?.response ||
        result?.result?.response ||
        result?.text ||
        result?.result?.text ||
        ""
      );
    }

    // =====================================
    // EXISTING AI ASSISTANT - preserved
    // =====================================
    if (url.pathname === "/api/ask") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question =
          typeof body?.question === "string" ? body.question.trim() :
          typeof body?.message === "string" ? body.message.trim() :
          typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!question) return json({ error: "Please enter a question." }, 400);
        const answer = await textAnswer(question, Boolean(body?.thinking));
        if (!answer) return json({ error: "AI did not return a readable answer." }, 502);
        return json({ answer });
      } catch (error) {
        return json({ error: "AI temporarily unavailable. Please try again later." }, 500);
      }
    }

    // =====================================
    // IMAGE UNDERSTANDING - Gemma 4 Vision
    // =====================================
    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question = typeof body?.question === "string" ? body.question.trim() : "Describe and help with this image.";
        const image = typeof body?.image === "string" ? body.image : "";
        if (!image.startsWith("data:image/")) return json({ error: "A valid image is required." }, 400);
        if (image.length > 16_000_000) return json({ error: "Image is too large. Please use a smaller photo." }, 413);

        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
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
          max_tokens: 4096,
        });
        const answer = result?.choices?.[0]?.message?.content || result?.response || result?.result?.response || "";
        if (!answer) return json({ error: "AI could not analyze this image." }, 502);
        return json({ answer });
      } catch (error) {
        return json({ error: "Image analysis is temporarily unavailable." }, 500);
      }
    }

    // =====================================
    // FILE UNDERSTANDING - Markdown Conversion + Gemma
    // =====================================
    if (url.pathname === "/api/file") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const form = await request.formData();
        const file = form.get("file");
        const question = String(form.get("question") || "Analyze this file and answer the user's request.").trim();
        const thinking = String(form.get("thinking") || "0") === "1";
        if (!(file instanceof File)) return json({ error: "Please attach a file." }, 400);
        if (file.size > 12 * 1024 * 1024) return json({ error: "File is too large. Maximum 12 MB." }, 413);

        const converted = await env.AI.toMarkdown({
          name: file.name || "attachment",
          blob: file,
        }, {
          conversionOptions: { output: { format: "text" } },
        });
        const item = Array.isArray(converted) ? converted[0] : converted;
        if (!item || item.format === "error") return json({ error: item?.error || "File conversion failed." }, 422);

        const text = String(item.data || "");
        const trimmed = text.slice(0, 120000);
        const answer = await textAnswer(
          "The user attached a file named '" + file.name + "'.\n\nFILE CONTENT:\n" + trimmed + "\n\nUSER REQUEST:\n" + question,
          thinking
        );
        if (!answer) return json({ error: "AI did not return a readable answer." }, 502);
        return json({ answer, filename: file.name });
      } catch (error) {
        return json({ error: "File analysis is temporarily unavailable." }, 500);
      }
    }

    // =====================================
    // IMAGE EDITING - FLUX.2 klein 4B
    // =====================================
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
        const mime = `image/${match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase()}`;
        const binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("input_image_0", new Blob([binary], { type: mime }), "input-image.${mime.split("/")[1]}");
        form.append("width", "1024");
        form.append("height", "1024");

        const formRequest = new Request("https://dummy.invalid", { method: "POST", body: form });
        const result = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
          multipart: {
            body: formRequest.body,
            contentType: formRequest.headers.get("content-type") || "multipart/form-data",
          },
        });
        if (!result?.image) return json({ error: "Image editing failed." }, 502);
        return json({ dataURI: `data:image/jpeg;base64,${result.image}`, answer: "ছবিটি আপনার prompt অনুযায়ী edit করার চেষ্টা করা হয়েছে।" });
      } catch (error) {
        return json({ error: "Image editing is temporarily unavailable. Please try again with a smaller photo." }, 503);
      }
    }

    // =====================================
    // IMAGE GENERATION - FLUX.1 schnell
    // =====================================
    if (url.pathname === "/api/image") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return json({ error: "Please enter an image prompt." }, 400);
        if (prompt.length > 2048) return json({ error: "Image prompt is too long." }, 400);

        const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
          prompt,
          steps: 4,
          seed: Math.floor(Math.random() * 2147483647),
        });
        if (!result?.image) return json({ error: "Image generation failed." }, 502);
        return json({ dataURI: `data:image/jpeg;base64,${result.image}` });
      } catch (error) {
        return json({ error: "Image generation is temporarily unavailable." }, 500);
      }
    }

    // =====================================
    // WEB SEARCH - AI Gateway / supported provider
    // =====================================
    if (url.pathname === "/api/search") {
      if (request.method !== "POST") return json({ error: "POST request required" }, 405);
      try {
        const body = await request.json();
        const question = typeof body?.question === "string" ? body.question.trim() : "";
        if (!question) return json({ error: "Please enter a search question." }, 400);

        const result = await env.AI.run("openai/gpt-5-mini", {
          input:
            "Search the web for the user's question and answer with concise, useful information. " +
            "Prefer authoritative sources. Clearly distinguish current facts from uncertainty.\n\nUser question: " + question,
          max_output_tokens: 4096,
          tools: [{ type: "web_search_preview" }],
        }, { gateway: { id: "default" } });

        const answer =
          result?.output_text ||
          result?.choices?.[0]?.message?.content ||
          result?.response ||
          result?.result?.response ||
          "";
        if (!answer) return json({ error: "Web search did not return a readable answer." }, 502);
        return json({ answer });
      } catch (error) {
        return json({
          error:
            "Web search needs Cloudflare AI Gateway to be enabled for this Worker. The existing AI Mode does not require this extra setup."
        }, 503);
      }
    }

    // =====================================
    // SHORT VIDEO - Runway Gen-4.5
    // =====================================
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

        const result = await env.AI.run("runwayml/gen-4.5", input);
        const video = result?.result?.video || result?.video;
        if (!video) return json({ error: "Video generation did not return a video." }, 502);
        return json({ video });
      } catch (error) {
        return json({
          error:
            "Short video generation needs an enabled Cloudflare AI Gateway/third-party model billing setup."
        }, 503);
      }
    }

    return new Response("Amar Sahayata API is running!", { headers: corsHeaders });
  },
};
