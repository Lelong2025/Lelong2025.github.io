import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // OPTIONS preflight requests
    const apiCors = buildCorsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: apiCors.originAllowed ? 204 : 403,
        headers: apiCors.headers
      });
    }

    // Webhook SePay — không cần JWT, dùng admin client trực tiếp
    if (path === "/hooks/sepay-payment") {
      return handleSepayWebhook(request, env);
    }

    if (path === "/api/chat") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleChat(req, env, ctx));
    }
    if (path === "/api/account" && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAccount(req, env, ctx, apiCors));
    }
    if (path === "/api/orders" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleCreateOrder(req, env, ctx, apiCors));
    }
    
    const orderMatch = path.match(/^\/api\/orders\/([A-Z0-9]+)\/status$/);
    if (orderMatch && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleOrderStatus(req, env, ctx, apiCors, orderMatch[1]));
    }

    if (path === "/" && request.method === "GET") {
      return new Response("Journal VIP API is running", {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...apiCors.headers }
      });
    }

    return jsonResponse({ error: "Not found" }, 404, apiCors.headers);
  }
};

async function withUserAuth(request, env, cors, handler) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);

  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    console.error("Supabase user authentication configuration is missing");
    return jsonResponse({ error: "Authentication service unavailable" }, 503, cors.headers);
  }

  try {
    const token = match[1].trim();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.warn("User token rejected by Supabase Auth", error?.message || "User missing");
      return jsonResponse({ error: "Invalid or expired session" }, 401, cors.headers);
    }

    return handler(request, {
      userClaims: { id: user.id, email: user.email },
      supabase,
      supabaseAdmin: getAdminClient(env)
    });
  } catch (error) {
    console.error("User authentication error", error.message);
    return jsonResponse({ error: "Authentication service unavailable" }, 503, cors.headers);
  }
}

async function handleChat(request, env, ctx) {
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
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
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

    const userId = ctx.userClaims?.id;
    if (!userId) {
      return jsonResponse({ error: "Authentication required" }, 401, corsHeaders);
    }

    // Kiểm tra và trừ lượt sử dụng bằng admin client (vượt qua RLS)
    const { data: usage, error: rpcError } = await ctx.supabaseAdmin.rpc("consume_ai_message", { p_user_id: userId });
    if (rpcError) throw rpcError;

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

    const openAiMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

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

function getAdminClient(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function handleAccount(request, env, ctx, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const userId = ctx.userClaims?.id;
    const userEmail = ctx.userClaims?.email;
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);

    const today = new Date().toISOString().slice(0, 10);
    const [subRes, usageRes] = await Promise.all([
      ctx.supabase.from("subscriptions")
        .select("status, expires_at, plan_id, vip_plans(name, price_vnd, duration_days, daily_ai_limit)")
        .eq("user_id", userId)
        .maybeSingle(),
      ctx.supabase.from("ai_usage")
        .select("message_count")
        .eq("user_id", userId)
        .eq("usage_date", today)
        .maybeSingle()
    ]);

    if (subRes.error) throw subRes.error;
    if (usageRes.error) throw usageRes.error;

    const subscription = subRes.data || null;
    const isVip = Boolean(subscription?.status === "active"
      && subscription.expires_at && new Date(subscription.expires_at) > new Date());

    return jsonResponse({
      user: { id: userId, email: userEmail },
      subscription,
      is_vip: isVip,
      usage_today: usageRes.data?.message_count || 0
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

async function handleCreateOrder(request, env, ctx, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);
    if (!env.SEPAY_BANK || !env.SEPAY_ACCOUNT_NUMBER) {
      return jsonResponse({ error: "Payment account is not configured" }, 503, cors.headers);
    }

    const { data: plans, error: planError } = await ctx.supabase.from("vip_plans")
      .select("id, name, price_vnd, duration_days, payment_prefix")
      .eq("id", "chatbox_ai")
      .eq("active", true);
    if (planError) throw planError;

    const plan = plans?.[0];
    if (!plan) return jsonResponse({ error: "VIP plan is unavailable" }, 503, cors.headers);

    const now = new Date().toISOString();
    const { data: pending, error: pendingError } = await ctx.supabase.from("payments")
      .select("id, payment_code, amount_vnd, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1);
    if (pendingError) throw pendingError;

    if (pending?.[0]) return jsonResponse(orderPayload(pending[0], env), 200, cors.headers);

    const payment = {
      user_id: userId,
      plan_id: plan.id,
      amount_vnd: plan.price_vnd,
      payment_code: randomPaymentCode(plan.payment_prefix),
      status: "pending"
    };

    // Tạo đơn thanh toán với admin client (vượt qua RLS của payments)
    const { data: inserted, error: insertError } = await ctx.supabaseAdmin.from("payments")
      .insert(payment)
      .select("id, payment_code, amount_vnd, status, expires_at");
    if (insertError) throw insertError;

    return jsonResponse(orderPayload(inserted[0], env), 201, cors.headers);
  } catch (error) {
    console.error("Create order error", error.message);
    return jsonResponse({ error: "Unable to create payment order" }, 500, cors.headers);
  }
}

async function handleOrderStatus(request, env, ctx, cors, code) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);

    const { data: rows, error: statusError } = await ctx.supabase.from("payments")
      .select("status, paid_at, expires_at")
      .eq("user_id", userId)
      .eq("payment_code", code)
      .limit(1);
    if (statusError) throw statusError;

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

async function verifySepayRequest(rawBody, request, env) {
  const signature = request.headers.get("X-SePay-Signature");
  const timestamp = request.headers.get("X-SePay-Timestamp");
  if (signature || timestamp) {
    return Boolean(env.SEPAY_WEBHOOK_SECRET)
      && await verifySepaySignature(rawBody, request, env.SEPAY_WEBHOOK_SECRET);
  }

  const authorization = request.headers.get("Authorization") || "";
  const apiKeyMatch = authorization.match(/^Apikey\s+(.+)$/i);
  const expectedApiKey = env.SEPAY_WEBHOOK_API_KEY || env.SEPAY_WEBHOOK_SECRET;
  return Boolean(apiKeyMatch && expectedApiKey)
    && safeEqual(apiKeyMatch[1].trim(), expectedApiKey);
}

function extractSepayPaymentCode(payload) {
  const directCode = String(payload.code || "").trim().toUpperCase();
  if (/^CHAT[A-Z0-9]{6,26}$/.test(directCode)) return directCode;

  // `code` can be null until the CHAT prefix is configured in SePay. The bank
  // transfer content still contains the exact code generated for the order.
  const transferText = `${payload.content || ""} ${payload.description || ""}`.toUpperCase();
  return transferText.match(/\bCHAT[A-Z0-9]{6,26}\b/)?.[0] || "";
}

async function handleSepayWebhook(request, env) {
  const secureHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  if (request.method !== "POST") return jsonResponse({ success: false }, 405, secureHeaders);

  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!env.SEPAY_WEBHOOK_SECRET && !env.SEPAY_WEBHOOK_API_KEY) || !env.SUPABASE_URL || !serviceKey) {
    console.error("SePay webhook configuration is missing");
    return jsonResponse({ success: false }, 503, secureHeaders);
  }

  try {
    const rawBody = await request.text();
    if (!rawBody || new TextEncoder().encode(rawBody).length > 65536) {
      return jsonResponse({ success: false }, 413, secureHeaders);
    }
    if (!await verifySepayRequest(rawBody, request, env)) {
      return jsonResponse({ success: false, error: "Webhook authentication failed" }, 401, secureHeaders);
    }
    const payload = JSON.parse(rawBody);
    const transactionId = String(payload.id || "");
    const paymentCode = extractSepayPaymentCode(payload);
    const amount = Number(payload.transferAmount);
    const incoming = String(payload.transferType || "").toLowerCase() === "in";
    const expectedAccount = String(env.SEPAY_ACCOUNT_NUMBER || "").replace(/\s/g, "");
    const actualAccount = String(payload.accountNumber || "").replace(/\s/g, "");

    if (!transactionId || !paymentCode || !Number.isSafeInteger(amount) || amount <= 0
      || !incoming || (expectedAccount && actualAccount !== expectedAccount)) {
      console.warn("SePay webhook payload rejected", {
        transactionId: Boolean(transactionId), paymentCode: Boolean(paymentCode),
        amount, incoming, accountMatches: !expectedAccount || actualAccount === expectedAccount
      });
      return jsonResponse({ success: false, processed: false, error: "Invalid payment data" }, 422, secureHeaders);
    }

    // Dùng admin client trực tiếp (bypass RLS) để gọi RPC
    const supabaseAdmin = getAdminClient(env);
    const { data: result, error } = await supabaseAdmin.rpc("process_sepay_payment", {
      p_payment_code: paymentCode,
      p_transaction_id: transactionId,
      p_amount: amount,
      p_payload: payload
    });
    if (error) throw error;

    if (!result?.ok) {
      console.warn("SePay payment was not processed", result?.reason || "unknown_reason");
      return jsonResponse({ success: false, processed: false, error: result?.reason || "Payment not processed" }, 422, secureHeaders);
    }
    return jsonResponse({ success: true, processed: true }, 200, secureHeaders);
  } catch (error) {
    console.error("SePay webhook error", error.message);
    return jsonResponse({ success: false }, 500, secureHeaders);
  }
}
