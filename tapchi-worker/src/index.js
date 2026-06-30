export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/webhook/sepay") return handleSepayWebhook(request, env);

    const apiCors = buildCorsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: apiCors.originAllowed ? 204 : 403,
        headers: apiCors.headers
      });
    }

    if (path === "/api/chat") return handleChat(request, env);
    if (path === "/api/account" && request.method === "GET") {
      return handleAccount(request, env, apiCors);
    }
    if (path === "/api/orders" && request.method === "POST") {
      return handleCreateOrder(request, env, apiCors);
    }
    const orderMatch = path.match(/^\/api\/orders\/([A-Z0-9]+)\/status$/);
    if (orderMatch && request.method === "GET") {
      return handleOrderStatus(request, env, apiCors, orderMatch[1]);
    }
    if (path === "/" && request.method === "GET") {
      return new Response("Journal VIP API is running", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...apiCors.headers }
      });
    }
    return jsonResponse({ error: "Not found" }, 404, apiCors.headers);
  }
};

async function handleChat(request, env) {
    // Xử lý CORS Preflight (OPTIONS)
    const allowedOrigins = new Set(
      (env.ALLOWED_ORIGINS || "https://lelong2025.github.io,http://localhost:8787,http://127.0.0.1:5500")
        .split(",").map(value => value.trim()).filter(Boolean)
    );
    const origin = request.headers.get("Origin");
    const originAllowed = origin && allowedOrigins.has(origin);
    const corsHeaders = {
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originAllowed ? 204 : 403, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return new Response("AI Journal Expert Worker is running 🚀", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...corsHeaders
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    if (!originAllowed) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const contentType = request.headers.get("Content-Type") || "";
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (!contentType.toLowerCase().startsWith("application/json") || contentLength > 65536) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    if (env.AI_RATE_LIMITER) {
      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.AI_RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders }
        });
      }
    }

    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > 65536) {
        return new Response(JSON.stringify({ error: "Request too large" }), {
          status: 413,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const body = JSON.parse(rawBody);
      const { messages, contextData } = body;

      const validMessages = Array.isArray(messages)
        && messages.length > 0
        && messages.length <= 12
        && messages.every(message => message
          && ["user", "assistant"].includes(message.role)
          && typeof message.content === "string"
          && message.content.length > 0
          && message.content.length <= 2000)
        && messages.reduce((sum, message) => sum + message.content.length, 0) <= 8000;
      const validContext = contextData === undefined
        || (contextData && typeof contextData === "object" && JSON.stringify(contextData).length <= 25000);

      if (!validMessages || !validContext) {
        return new Response(JSON.stringify({ error: "Invalid request payload. 'messages' array is required." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const user = await requireUser(request, env);
      if (!user) {
        return jsonResponse({ error: "Authentication required" }, 401, corsHeaders);
      }

      const usage = await supabaseRpc(env, "consume_ai_message", { p_user_id: user.id });
      if (!usage?.allowed) {
        const status = usage?.reason === "daily_limit" ? 429 : 403;
        return jsonResponse({
          error: usage?.reason || "vip_required",
          limit: usage?.limit || null
        }, status, corsHeaders);
      }

      // Xây dựng chuỗi văn bản ngữ cảnh từ dữ liệu cục bộ
      let contextText = "";
      if (contextData) {
        const { hdgsnnMatches, jcrMatches, scopusMatches } = contextData;
        
        if (hdgsnnMatches && hdgsnnMatches.length > 0) {
          contextText += "\n\n--- DỮ LIỆU TẠP CHÍ HĐGSNN (CỤC BỘ) ---\n";
          hdgsnnMatches.forEach((item, idx) => {
            contextText += `${idx + 1}. Tên tạp chí: ${item["Tên Tạp chí"] || "N/A"}\n`;
            contextText += `   ISSN: ${item["ISSN"] || "N/A"}\n`;
            contextText += `   Khung điểm HĐGSNN: ${item["Điểm HDDGSNN"] !== undefined ? item["Điểm HDDGSNN"] : "N/A"}\n`;
          });
        }
        
        if (jcrMatches && jcrMatches.length > 0) {
          contextText += "\n\n--- DỮ LIỆU JCR IMPACT FACTOR (CỤC BỘ) ---\n";
          jcrMatches.forEach((item, idx) => {
            contextText += `${idx + 1}. Tên: ${item["journal_name"] || "N/A"}\n`;
            contextText += `   ISSN: ${item["issn"] || "N/A"} | eISSN: ${item["eissn"] || "N/A"}\n`;
            contextText += `   Ngành/Lĩnh vực: ${item["category"] || "N/A"}\n`;
            contextText += `   Impact Factor 2023 (2024 JCR): ${item["2024_JCR"] || "N/A"}\n`;
            contextText += `   Impact Factor 2024 (2025 JCR): ${item["2025_JCR"] || "N/A"}\n`;
            contextText += `   Phân hạng Q: ${item["JIF Quartile"] || "N/A"}\n`;
          });
        }
        
        if (scopusMatches && scopusMatches.length > 0) {
          contextText += "\n\n--- DỮ LIỆU SCOPUS (CỤC BỘ) ---\n";
          scopusMatches.forEach((item, idx) => {
            contextText += `${idx + 1}. Tên nguồn: ${item["Source Title"] || "N/A"}\n`;
            contextText += `   ISSN: ${item["ISSN"] || "N/A"} | EISSN: ${item["EISSN"] || "N/A"}\n`;
            contextText += `   Nhà xuất bản: ${item["Publisher"] || "N/A"}\n`;
            contextText += `   Thời gian bao phủ (Coverage): ${item["Coverage"] || "N/A"}\n`;
            contextText += `   Loại nguồn: ${item["Source Type"] || "N/A"}\n`;
            contextText += `   Trạng thái hoạt động: ${item["Active or Inactive"] || "N/A"}\n`;
            contextText += `   Bị Scopus ngừng nhận (Discontinued): ${item["Titles Discontinued by Scopus"] ? "Có" : "Không"}\n`;
            contextText += `   Trạng thái Open Access: ${item["Open Access Status"] || "Không"}\n`;
          });
        }
      }

      // Xây dựng System Prompt của chuyên gia tạp chí khoa học
      const systemPrompt = `Bạn là một chuyên gia hàng đầu về các tạp chí khoa học trong và ngoài nước. Bạn hỗ trợ các nhà nghiên cứu tra cứu và tìm kiếm thông tin về các tạp chí khoa học, bao gồm điểm HĐGSNN 2025 (Hội đồng Giáo sư Nhà nước Việt Nam), chỉ số JCR (Impact Factor), phân hạng Q (Quartile), và trạng thái Scopus.

Hãy trả lời một cách lịch sự, chuyên nghiệp, khoa học, rõ ràng và trung thực bằng Tiếng Việt. Định dạng câu trả lời của bạn thật đẹp mắt bằng Markdown (sử dụng in đậm, danh sách gạch đầu dòng, bảng biểu, liên kết nếu có).

Dưới đây là kết quả tra cứu từ cơ sở dữ liệu cục bộ của trang web (nếu có):${contextText ? contextText : "\n(Không có dữ liệu trùng khớp trong cơ sở dữ liệu cục bộ)"}

HƯỚNG DẪN XỬ LÝ THÔNG TIN:
1. Nếu có DỮ LIỆU CỤC BỘ: Hãy ưu tiên sử dụng thông tin này làm căn cứ chính xác nhất để trả lời chi tiết và rõ ràng về tạp chí đó (vd: điểm số cụ thể năm 2025, IF thực tế, trạng thái Scopus). Tránh suy đoán khác với dữ liệu được cung cấp.
2. Nếu KHÔNG CÓ DỮ LIỆU CỤC BỘ hoặc người dùng hỏi câu hỏi chung chung bên ngoài: Hãy trả lời dựa trên kiến thức sâu rộng của bạn về tạp chí khoa học đó. Nếu bạn không chắc chắn về một thông tin cụ thể (như điểm HĐGSNN chính xác hoặc IF mới nhất), hãy nói rõ và khuyên người dùng kiểm tra bằng thanh tìm kiếm chính của trang web hoặc văn bản chính thức của HĐGSNN để đối chiếu.
3. Khi người dùng hỏi về một tạp chí cụ thể, ví dụ "Tạp chí khoa học lạc hồng issn 2525-2186": Hãy trích xuất thông tin từ dữ liệu cục bộ bên trên (nếu có) và trình bày thật mạch lạc: Tên tạp chí, chỉ số ISSN, cơ quan/trường xuất bản, điểm HĐGSNN hoặc các chỉ số quốc tế tương ứng.
4. TÍCH HỢP TÌM KIẾM TẠP CHÍ KHOA HỌC LẠC HỒNG (LHU Journal of Science):
   - Trang web chính thức là: https://tapchikhoahoc.lhu.edu.vn/
   - Khi người dùng hỏi về các công trình nghiên cứu, bài báo khoa học hoặc tạp chí thuộc Đại học Lạc Hồng, hãy luôn hướng dẫn họ truy cập hoặc tìm kiếm tại trang web này.
   - Đặc biệt, hãy tự động sinh một liên kết tìm kiếm trực tiếp cho họ theo định dạng: \`[Tìm bài viết trên Tạp chí Khoa học Lạc Hồng](https://tapchikhoahoc.lhu.edu.vn/search/?q=TỪ_KHÓA_TÌM_KIẾM)\` (thay \`TỪ_KHÓA_TÌM_KIẾM\` bằng từ khóa tên bài báo, tên tác giả hoặc chủ đề mà họ đang hỏi để họ chỉ cần click là tra cứu được ngay).`;

      // Tạo mảng tin nhắn gửi tới OpenAI
      const openAiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];

      // Gọi OpenAI API qua Cloudflare AI Gateway để tránh bị chặn địa lý (Hồng Kông/Việt Nam)
      const openAiResponse = await fetch("https://gateway.ai.cloudflare.com/v1/0b2220df0295474315b4b6940a0785e8/tapchi-gateway/openai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: openAiMessages,
          temperature: 0.7,
          max_tokens: 1500
        })
      });

      if (!openAiResponse.ok) {
        const errText = await openAiResponse.text();
        console.error("OpenAI API Error:", errText);
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), {
          status: openAiResponse.status,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const openAiData = await openAiResponse.json();
      const reply = openAiData.choices[0].message.content;

      return new Response(JSON.stringify({ result: reply, usage }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err) {
      console.error("Worker Error:", err.message);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
}

function buildCorsHeaders(request, env) {
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS || "https://lelong2025.github.io,http://localhost:8787,http://127.0.0.1:5500")
      .split(",").map(value => value.trim()).filter(Boolean)
  );
  const origin = request.headers.get("Origin");
  const originAllowed = Boolean(origin && allowedOrigins.has(origin));
  return {
    originAllowed,
    headers: {
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function hasApiConfig(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

async function requireUser(request, env) {
  if (!hasApiConfig(env)) throw new Error("Supabase server configuration is missing");
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": auth
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function supabaseRequest(env, path, options = {}) {
  if (!hasApiConfig(env)) throw new Error("Supabase server configuration is missing");
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    console.error("Supabase error", response.status, text.slice(0, 500));
    throw new Error("Database request failed");
  }
  return data;
}

async function supabaseRpc(env, name, payload) {
  return supabaseRequest(env, `rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function handleAccount(request, env, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const user = await requireUser(request, env);
    if (!user) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);
    const today = new Date().toISOString().slice(0, 10);
    const [subscriptions, usage] = await Promise.all([
      supabaseRequest(env,
        `subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=status,expires_at,plan_id,vip_plans(name,price_vnd,duration_days,daily_ai_limit)`),
      supabaseRequest(env,
        `ai_usage?user_id=eq.${encodeURIComponent(user.id)}&usage_date=eq.${today}&select=message_count`)
    ]);
    const subscription = subscriptions?.[0] || null;
    const isVip = Boolean(subscription?.status === "active"
      && subscription.expires_at && new Date(subscription.expires_at) > new Date());
    return jsonResponse({
      user: { id: user.id, email: user.email },
      subscription,
      is_vip: isVip,
      usage_today: usage?.[0]?.message_count || 0
    }, 200, cors.headers);
  } catch (error) {
    console.error("Account error", error.message);
    return jsonResponse({ error: "Unable to load account" }, 500, cors.headers);
  }
}

function randomPaymentCode(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  const suffix = [...bytes].map(value => value.toString(36).padStart(2, "0")).join("").toUpperCase();
  return `${prefix}${suffix}`.slice(0, 24);
}

function orderPayload(order, env) {
  const params = new URLSearchParams({
    acc: env.SEPAY_ACCOUNT_NUMBER,
    bank: env.SEPAY_BANK,
    amount: String(order.amount_vnd),
    des: order.payment_code,
    template: "compact"
  });
  if (env.SEPAY_ACCOUNT_NAME) params.set("holder", env.SEPAY_ACCOUNT_NAME);
  return {
    id: order.id,
    code: order.payment_code,
    amount: order.amount_vnd,
    status: order.status,
    expires_at: order.expires_at,
    bank: env.SEPAY_BANK,
    account_number: env.SEPAY_ACCOUNT_NUMBER,
    account_name: env.SEPAY_ACCOUNT_NAME || "",
    qr_url: `https://vietqr.app/img?${params.toString()}`
  };
}

async function handleCreateOrder(request, env, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const user = await requireUser(request, env);
    if (!user) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);
    if (!env.SEPAY_BANK || !env.SEPAY_ACCOUNT_NUMBER) {
      return jsonResponse({ error: "Payment account is not configured" }, 503, cors.headers);
    }

    const plans = await supabaseRequest(env,
      "vip_plans?id=eq.chatbox_ai&active=eq.true&select=id,name,price_vnd,duration_days,payment_prefix");
    const plan = plans?.[0];
    if (!plan) return jsonResponse({ error: "VIP plan is unavailable" }, 503, cors.headers);

    const now = new Date().toISOString();
    const pending = await supabaseRequest(env,
      `payments?user_id=eq.${encodeURIComponent(user.id)}&status=eq.pending&expires_at=gt.${encodeURIComponent(now)}`
      + "&select=id,payment_code,amount_vnd,status,expires_at&order=created_at.desc&limit=1");
    if (pending?.[0]) return jsonResponse(orderPayload(pending[0], env), 200, cors.headers);

    const payment = {
      user_id: user.id,
      plan_id: plan.id,
      amount_vnd: plan.price_vnd,
      payment_code: randomPaymentCode(plan.payment_prefix),
      status: "pending"
    };
    const inserted = await supabaseRequest(env, "payments", {
      method: "POST",
      headers: { "Prefer": "return=representation" },
      body: JSON.stringify(payment)
    });
    return jsonResponse(orderPayload(inserted[0], env), 201, cors.headers);
  } catch (error) {
    console.error("Create order error", error.message);
    return jsonResponse({ error: "Unable to create payment order" }, 500, cors.headers);
  }
}

async function handleOrderStatus(request, env, cors, code) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const user = await requireUser(request, env);
    if (!user) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);
    const rows = await supabaseRequest(env,
      `payments?user_id=eq.${encodeURIComponent(user.id)}&payment_code=eq.${encodeURIComponent(code)}`
      + "&select=status,paid_at,expires_at&limit=1");
    if (!rows?.[0]) return jsonResponse({ error: "Order not found" }, 404, cors.headers);
    const row = rows[0];
    if (row.status === "pending" && new Date(row.expires_at) <= new Date()) row.status = "expired";
    return jsonResponse(row, 200, cors.headers);
  } catch (error) {
    console.error("Order status error", error.message);
    return jsonResponse({ error: "Unable to load order" }, 500, cors.headers);
  }
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function verifySepaySignature(rawBody, request, secret) {
  const signature = request.headers.get("X-SePay-Signature") || "";
  const timestamp = request.headers.get("X-SePay-Timestamp") || "";
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber)
    || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)
  );
  const expected = "sha256=" + [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return safeEqual(signature, expected);
}

async function handleSepayWebhook(request, env) {
  const secureHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.method !== "POST") return jsonResponse({ success: false }, 405, secureHeaders);
  if (!env.SEPAY_WEBHOOK_SECRET || !hasApiConfig(env)) {
    console.error("SePay webhook configuration is missing");
    return jsonResponse({ success: false }, 503, secureHeaders);
  }
  try {
    const rawBody = await request.text();
    if (!rawBody || new TextEncoder().encode(rawBody).length > 65536) {
      return jsonResponse({ success: false }, 413, secureHeaders);
    }
    if (!await verifySepaySignature(rawBody, request, env.SEPAY_WEBHOOK_SECRET)) {
      return jsonResponse({ success: false }, 401, secureHeaders);
    }
    const payload = JSON.parse(rawBody);
    const transactionId = String(payload.id || "");
    const paymentCode = String(payload.code || "").trim().toUpperCase();
    const amount = Number(payload.transferAmount);
    const incoming = String(payload.transferType || "").toLowerCase() === "in";
    const expectedAccount = String(env.SEPAY_ACCOUNT_NUMBER || "").replace(/\s/g, "");
    const actualAccount = String(payload.accountNumber || "").replace(/\s/g, "");

    if (!transactionId || !paymentCode || !Number.isSafeInteger(amount) || amount <= 0
      || !incoming || (expectedAccount && actualAccount !== expectedAccount)) {
      return jsonResponse({ success: true, processed: false }, 200, secureHeaders);
    }

    const result = await supabaseRpc(env, "process_sepay_payment", {
      p_payment_code: paymentCode,
      p_transaction_id: transactionId,
      p_amount: amount,
      p_payload: payload
    });
    return jsonResponse({ success: true, processed: Boolean(result?.ok) }, 200, secureHeaders);
  } catch (error) {
    console.error("SePay webhook error", error.message);
    return jsonResponse({ success: false }, 500, secureHeaders);
  }
}
