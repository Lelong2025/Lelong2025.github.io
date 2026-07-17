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
    if (path === "/api/magazine/review" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleMagazineReview(req, env, ctx, apiCors));
    }
    if (path === "/api/account" && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleCleanAccount(req, env, ctx, apiCors));
    }
    if (path === "/api/public/config" && request.method === "GET") {
      return handlePublicConfig(env, apiCors);
    }
    if (path === "/api/services" && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleServices(req, env, ctx, apiCors));
    }
    if (path === "/api/usage/reserve" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleReserveUsage(req, env, ctx, apiCors));
    }
    if (path === "/api/usage/finalize" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleFinalizeUsage(req, env, ctx, apiCors));
    }
    if (path === "/api/renewals" && request.method === "PATCH") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleRenewalPreference(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/dashboard" && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleCleanAdminDashboard(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/settings" && request.method === "PATCH") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminSettings(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/service-plans" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminCreateServicePlan(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/service-plans" && request.method === "PATCH") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminUpdateServicePlan(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/lookup-sources" && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminListLookupSources(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/lookup-sources" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminCreateLookupSource(req, env, ctx, apiCors));
    }
    if (path === "/api/admin/lookup-sources" && request.method === "PATCH") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminUpdateLookupSource(req, env, ctx, apiCors));
    }
    const lookupSourceMatch = path.match(/^\/api\/admin\/lookup-sources\/([0-9a-f-]{36})$/i);
    if (lookupSourceMatch && request.method === "DELETE") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleAdminDeleteLookupSource(req, env, ctx, apiCors, lookupSourceMatch[1]));
    }
    if (path === "/api/orders" && request.method === "POST") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleCreateOrder(req, env, ctx, apiCors));
    }
    
    const orderMatch = path.match(/^\/api\/orders\/([A-Z0-9]+)\/status$/);
    if (orderMatch && request.method === "GET") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleOrderStatus(req, env, ctx, apiCors, orderMatch[1]));
    }
    const cancelOrderMatch = path.match(/^\/api\/orders\/([A-Z0-9]+)$/);
    if (cancelOrderMatch && request.method === "DELETE") {
      return withUserAuth(request, env, apiCors, (req, ctx) => handleCancelOrder(req, env, ctx, apiCors, cancelOrderMatch[1]));
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

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    console.error("Supabase user authentication configuration is missing");
    return jsonResponse({
      error: "Backend local thiếu cấu hình Supabase. Kiểm tra SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY và SUPABASE_SECRET_KEY trong backend/.env.",
      code: "backend_env_missing"
    }, 503, cors.headers);
  }

  const token = match[1].trim();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let user;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      console.warn("User token rejected by Supabase Auth", error?.message || "User missing");
      return jsonResponse({ error: "Invalid or expired session" }, 401, cors.headers);
    }
    user = data.user;
  } catch (error) {
    console.error("Supabase auth getUser failed", error.message);
    return jsonResponse({
      error: "Backend local chưa gọi được Supabase Auth. Kiểm tra mạng hoặc SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY trong backend/.env.",
      code: "supabase_auth_unavailable",
      detail: error?.message || "unknown"
    }, 503, cors.headers);
  }

  const supabaseAdmin = getAdminClient(env);
  let role = user.app_metadata?.role || user.user_metadata?.role || "user";
  if (role !== "admin" && user.email) {
    try {
      const { data: adminUser, error: adminError } = await supabaseAdmin.from("admin_users")
        .select("email")
        .ilike("email", user.email)
        .maybeSingle();
      if (adminError) console.error("Admin role lookup failed", adminError.message);
      if (adminUser) role = "admin";
    } catch (error) {
      console.error("Admin role lookup crashed", error.message);
    }
  }

  try {
    return await handler(request, {
      userClaims: { id: user.id, email: user.email, role },
      supabase,
      supabaseAdmin
    });
  } catch (error) {
    console.error("Authenticated API handler error", error.message);
    if (isDatabaseMigrationError(error)) return databaseMigrationResponse(cors);
    return jsonResponse({
      error: "Backend xử lý API chưa được. Xem terminal backend để biết lỗi chi tiết.",
      code: "api_handler_unavailable",
      detail: error?.message || "unknown"
    }, 503, cors.headers);
  }
}

async function handleChat(request, env, ctx) {
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",").map(value => value.trim()).filter(Boolean)
  );
  addLocalDevOrigins(allowedOrigins);
  const origin = request.headers.get("Origin");
  const originAllowed = Boolean(origin && (allowedOrigins.has(origin) || isLocalDevOrigin(origin)));
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
    const clientIp = request.headers.get("CF-Connecting-IP")
      || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
      || "unknown";
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

    let usage = { allowed: true, unlimited: ctx.userClaims?.role === "admin" };
    let usageReservationId = null;
    if (ctx.userClaims?.role === "admin") {
      const { data: adminUsage, error: adminUsageError } = await ctx.supabaseAdmin.from("service_usage").insert({
        user_id: userId, product_code: "chatbox_ai", action: "chat_message", units: 1,
        source: "admin", status: "reserved", idempotency_key: `chat-${crypto.randomUUID()}`
      }).select("id").single();
      if (adminUsageError) throw adminUsageError;
      usageReservationId = adminUsage.id;
    } else {
      const { data: dbUsage, error: rpcError } = await ctx.supabaseAdmin.rpc("reserve_service_usage", {
        p_user_id: userId,
        p_product_code: "chatbox_ai",
        p_action: "chat_message",
        p_idempotency_key: `chat-${crypto.randomUUID()}`,
        p_metadata: {}
      });
      if (rpcError) throw rpcError;
      usage = dbUsage;
      usageReservationId = dbUsage?.reservation_id || null;
    }

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
      if (usageReservationId) {
        await ctx.supabaseAdmin.rpc("finalize_service_usage", {
          p_user_id: userId, p_reservation_id: usageReservationId, p_success: false
        });
      }
      return new Response(JSON.stringify({ error: "AI service temporarily unavailable" }), {
        status: openAiResponse.status,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const openAiData = await openAiResponse.json();
    const reply = openAiData.choices[0].message.content;
    if (usageReservationId) {
      const { error: finalizeError } = await ctx.supabaseAdmin.rpc("finalize_service_usage", {
        p_user_id: userId, p_reservation_id: usageReservationId, p_success: true
      });
      if (finalizeError) console.error("Finalize Chatbox usage failed", finalizeError.message);
    }

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

async function handleMagazineReview(request, env, ctx, cors) {
  let reservationId = null;
  let externallyManagedReservation = false;
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 60000) {
      return jsonResponse({ error: "Nội dung review không hợp lệ" }, 400, cors.headers);
    }

    const suppliedReservationId = typeof body.usage_reservation_id === "string" ? body.usage_reservation_id.trim() : "";
    if (suppliedReservationId) {
      const { data, error } = await ctx.supabaseAdmin.from("service_usage")
        .select("id")
        .eq("id", suppliedReservationId)
        .eq("user_id", ctx.userClaims.id)
        .eq("product_code", "magazine_ai_review")
        .eq("status", "reserved")
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) return jsonResponse({ error: "Lượt AI Review không hợp lệ hoặc đã kết thúc" }, 403, cors.headers);
      reservationId = data.id;
      externallyManagedReservation = true;
    } else if (ctx.userClaims.role === "admin") {
      // Admin is permanently unlimited. Usage logging must never block the operation.
      externallyManagedReservation = true;
    } else {
      const { data, error } = await ctx.supabaseAdmin.rpc("reserve_service_usage", {
        p_user_id: ctx.userClaims.id,
        p_product_code: "magazine_ai_review",
        p_action: "article_review",
        p_idempotency_key: `review-${crypto.randomUUID()}`,
        p_metadata: {}
      });
      if (error) throw error;
      if (!data?.allowed) {
        return jsonResponse({ error: data?.reason || "Không còn lượt AI Review", ...data }, data?.reason === "daily_limit" ? 429 : 403, cors.headers);
      }
      reservationId = data.reservation_id || null;
    }

    const response = await fetch("https://gateway.ai.cloudflare.com/v1/0b2220df0295474315b4b6940a0785e8/tapchi-gateway/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`
      },
      body: JSON.stringify({
        model: env.OPENAI_REVIEW_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error(`AI gateway returned ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("AI response is empty");

    if (reservationId && !externallyManagedReservation) await ctx.supabaseAdmin.rpc("finalize_service_usage", {
      p_user_id: ctx.userClaims.id, p_reservation_id: reservationId, p_success: true
    });
    return jsonResponse({ content }, 200, cors.headers);
  } catch (error) {
    if (reservationId && !externallyManagedReservation) await ctx.supabaseAdmin.rpc("finalize_service_usage", {
      p_user_id: ctx.userClaims.id, p_reservation_id: reservationId, p_success: false
    }).catch(() => {});
    console.error("Magazine AI review error", error.message);
    return jsonResponse({ error: "Dịch vụ AI Review tạm thời không khả dụng" }, 502, cors.headers);
  }
}

function buildCorsHeaders(request, env) {
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",").map(value => value.trim()).filter(Boolean)
  );
  addLocalDevOrigins(allowedOrigins);
  const origin = request.headers.get("Origin");
  const originAllowed = Boolean(origin && (allowedOrigins.has(origin) || isLocalDevOrigin(origin)));
  return {
    originAllowed,
    headers: {
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    }
  };
}

function addLocalDevOrigins(allowedOrigins) {
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ].forEach(origin => allowedOrigins.add(origin));
}

function isLocalDevOrigin(origin = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function getAdminClient(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isDatabaseMigrationError(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (text.includes("column") || text.includes("function") || text.includes("schema cache") || text.includes("relation") || text.includes("table"))
    && (text.includes("does not exist")
      || text.includes("could not find")
      || text.includes("wallet_balance_vnd")
      || text.includes("wallet_amount_vnd")
      || text.includes("order_type")
      || text.includes("ai_wallet_unit_price_vnd")
      || text.includes("ai_credits_remaining")
      || text.includes("credits_granted")
      || text.includes("activate_free_trial")
      || text.includes("service_products")
      || text.includes("service_plans")
      || text.includes("user_entitlements")
      || text.includes("user_wallets")
      || text.includes("auto_renew_preferences")
      || text.includes("service_daily_usage")
      || text.includes("service_usage"));
}

function databaseMigrationResponse(cors) {
  return jsonResponse({
    error: "Database chưa cập nhật. Hãy chạy Database/migrate_multi_service_billing.sql trên Supabase, sau đó chạy thêm Database/migrate_lookup_sources.sql nếu dùng trang Nguồn tra cứu.",
    code: "migration_required"
  }, 503, cors.headers);
}

function paidAccessFromDatabase({ payments = [], subscription = null }) {
  const paidPayments = payments.filter(payment => payment.status === "paid");
  const remainingCredits = Math.max(Number(subscription?.ai_credits_remaining || 0), 0);
  const walletBalance = Number(subscription?.wallet_balance_vnd || 0);
  const walletRenewPrice = Math.max(Number(subscription?.vip_plans?.price_vnd || 0), 1);
  const hasPaid = paidPayments.length > 0;
  const paidActive = hasPaid && (remainingCredits > 0 || walletBalance >= walletRenewPrice);
  return {
    hasPaid,
    paidActive,
    remainingCredits,
    walletBalance,
    walletRenewPrice,
    totalCredits: remainingCredits
  };
}

async function handleAccount(request, env, ctx, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const userId = ctx.userClaims?.id;
    const userEmail = ctx.userClaims?.email;
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);

    const today = new Date().toISOString().slice(0, 10);
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 29);
    const [subRes, usageRes, paymentsRes, usageHistoryRes] = await Promise.all([
      ctx.supabase.from("subscriptions")
        .select("status, expires_at, ai_credits_remaining, wallet_balance_vnd, trial_started_at, trial_ends_at, plan_id, vip_plans(name, price_vnd, trial_days, daily_ai_limit, ai_credit_amount, ai_wallet_unit_price_vnd)")
        .eq("user_id", userId)
        .maybeSingle(),
      ctx.supabase.from("ai_usage")
        .select("message_count")
        .eq("user_id", userId)
        .eq("usage_date", today)
        .maybeSingle(),
      ctx.supabase.from("payments")
        .select("id, plan_id, amount_vnd, payment_code, status, credits_granted, wallet_amount_vnd, order_type, created_at, paid_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      ctx.supabase.from("ai_usage")
        .select("usage_date, message_count")
        .eq("user_id", userId)
        .gte("usage_date", weekStart.toISOString().slice(0, 10))
        .order("usage_date", { ascending: true })
    ]);

    if (subRes.error) throw subRes.error;
    if (usageRes.error) throw usageRes.error;
    if (paymentsRes.error) throw paymentsRes.error;
    if (usageHistoryRes.error) throw usageHistoryRes.error;

    let subscription = subRes.data || null;
    const paidAccess = paidAccessFromDatabase({
      payments: paymentsRes.data || [],
      subscription
    });
    if (subscription && paidAccess.hasPaid) {
      subscription = {
        ...subscription,
        ai_credits_remaining: paidAccess.remainingCredits,
        wallet_balance_vnd: paidAccess.walletBalance,
        status: paidAccess.paidActive ? "active" : "inactive"
      };
    }
    let isTrial = Boolean(!paidAccess.hasPaid && subscription?.status === "active" && subscription?.trial_ends_at
      && new Date(subscription.trial_ends_at) > new Date());
    let isVip = paidAccess.paidActive || isTrial;

    if (ctx.userClaims?.role === "admin") {
      isVip = true;
      isTrial = false;
      if (!subscription) {
        subscription = {
          status: "active",
          expires_at: null,
          ai_credits_remaining: null,
          wallet_balance_vnd: null,
          vip_plans: {
            name: "Vô hạn (Admin)",
            daily_ai_limit: 99999,
            ai_credit_amount: 99999,
            ai_wallet_unit_price_vnd: 1,
            trial_days: 0
          }
        };
      } else {
        subscription.status = "active";
        subscription.expires_at = null;
        subscription.ai_credits_remaining = null;
        subscription.wallet_balance_vnd = null;
        subscription.vip_plans = {
          ...subscription.vip_plans,
          name: "Vô hạn (Admin)",
          daily_ai_limit: 99999,
          ai_credit_amount: 99999,
          ai_wallet_unit_price_vnd: 1
        };
      }
    }

    return jsonResponse({
      user: { id: userId, email: userEmail },
      role: ctx.userClaims.role,
      subscription,
      is_vip: isVip,
      is_trial: isTrial,
      remaining_credits: ctx.userClaims?.role === "admin" ? null : paidAccess.remainingCredits,
      wallet_balance_vnd: ctx.userClaims?.role === "admin" ? null : paidAccess.walletBalance,
      usage_today: usageRes.data?.message_count || 0,
      usage_history: usageHistoryRes.data || [],
      payments: paymentsRes.data || []
    }, 200, cors.headers);
  } catch (error) {
    console.error("Account error", error.message);
    if (isDatabaseMigrationError(error)) {
      return databaseMigrationResponse(cors);
    }
    return jsonResponse({
      error: "Unable to load account",
      code: "account_unavailable",
      detail: error?.code || error?.message || "unknown"
    }, 500, cors.headers);
  }
}

async function handleCleanAccount(request, env, ctx, cors) {
  try {
    const [services, paymentsRes, usageRes] = await Promise.all([
      loadServiceAccount(ctx),
      ctx.supabaseAdmin.from("payments")
        .select("id, product_code, service_plan_id, amount_vnd, payment_code, status, credits_granted, wallet_amount_vnd, order_type, created_at, paid_at, expires_at")
        .eq("user_id", ctx.userClaims.id).order("created_at", { ascending: false }),
      ctx.supabaseAdmin.from("service_usage")
        .select("product_code, created_at").eq("user_id", ctx.userClaims.id).eq("status", "consumed")
        .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at")
    ]);
    if (paymentsRes.error) throw paymentsRes.error;
    if (usageRes.error) throw usageRes.error;
    const chat = services.products.find(product => product.code === 'chatbox_ai');
    const entitlement = chat?.entitlement || {};
    const trialActive = entitlement.trial_ends_at && new Date(entitlement.trial_ends_at) > new Date();
    const quotaRemaining = Number(entitlement.daily_remaining || 0);
    const remaining = Number(entitlement.credit_balance || 0) + quotaRemaining;
    return jsonResponse({
      user: { id: ctx.userClaims.id, email: ctx.userClaims.email },
      role: ctx.userClaims.role,
      is_vip: services.is_admin || trialActive || remaining > 0,
      is_trial: Boolean(!services.is_admin && trialActive),
      remaining_credits: services.is_admin ? null : remaining,
      wallet_balance_vnd: services.wallet_balance_vnd,
      usage_today: Number(entitlement.daily_usage || 0),
      usage_history: Object.entries((usageRes.data || []).reduce((days, row) => {
        const date = String(row.created_at).slice(0, 10);
        days[date] = (days[date] || 0) + 1;
        return days;
      }, {})).map(([usage_date, message_count]) => ({ usage_date, message_count })),
      payments: paymentsRes.data || [],
      services
    }, 200, cors.headers);
  } catch (error) {
    console.error("Clean account error", error.message);
    if (isDatabaseMigrationError(error)) return databaseMigrationResponse(cors);
    return jsonResponse({ error: "Unable to load account" }, 500, cors.headers);
  }
}

async function loadServiceAccount(ctx) {
  const userId = ctx.userClaims.id;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [productsRes, plansRes, entitlementsRes, walletRes, renewalsRes, dailyUsageRes] = await Promise.all([
    ctx.supabaseAdmin.from("service_products")
      .select("code, name, description, trial_days, trial_daily_limit, active")
      .eq("active", true).order("created_at"),
    ctx.supabaseAdmin.from("service_plans")
      .select("id, product_code, name, billing_type, price_vnd, credits, duration_days, active, sort_order")
      .eq("active", true).order("product_code").order("sort_order"),
    ctx.supabaseAdmin.from("user_entitlements")
      .select("product_code, credit_balance, monthly_balance, monthly_plan_id, monthly_started_at, monthly_ends_at, trial_started_at, trial_ends_at, trial_daily_limit")
      .eq("user_id", userId),
    ctx.supabaseAdmin.from("user_wallets").select("balance_vnd").eq("user_id", userId).maybeSingle(),
    ctx.supabaseAdmin.from("auto_renew_preferences")
      .select("product_code, plan_id, enabled").eq("user_id", userId),
    ctx.supabaseAdmin.from("service_daily_usage")
      .select("product_code, usage_count").eq("user_id", userId).eq("usage_date", todayUtc)
  ]);
  for (const result of [productsRes, plansRes, entitlementsRes, walletRes, renewalsRes, dailyUsageRes]) {
    if (result.error) throw result.error;
  }
  const dailyUsage = new Map((dailyUsageRes.data || []).map(row => [row.product_code, Number(row.usage_count || 0)]));
  const now = Date.now();
  const entitlements = new Map((entitlementsRes.data || []).map(row => {
    const usedToday = dailyUsage.get(row.product_code) || 0;
    const trialActive = row.trial_ends_at && new Date(row.trial_ends_at).getTime() > now;
    const monthlyActive = row.monthly_ends_at && new Date(row.monthly_ends_at).getTime() > now;
    const dailyLimit = trialActive
      ? Number(row.trial_daily_limit || 0)
      : monthlyActive ? Number(row.monthly_balance || 0) : 0;
    return [row.product_code, {
      ...row,
      daily_usage: usedToday,
      daily_limit: dailyLimit,
      daily_remaining: Math.max(dailyLimit - usedToday, 0)
    }];
  }));
  const renewals = new Map((renewalsRes.data || []).map(row => [row.product_code, row]));
  return {
    is_admin: ctx.userClaims.role === "admin",
    wallet_balance_vnd: ctx.userClaims.role === "admin" ? null : Number(walletRes.data?.balance_vnd || 0),
    products: (productsRes.data || []).map(product => ({
      ...product,
      entitlement: entitlements.get(product.code) || null,
      auto_renew: renewals.get(product.code) || null,
      unlimited: ctx.userClaims.role === "admin"
    })),
    plans: plansRes.data || []
  };
}

async function handleServices(request, env, ctx, cors) {
  try {
    return jsonResponse(await loadServiceAccount(ctx), 200, cors.headers);
  } catch (error) {
    console.error("Services account error", error.message);
    if (isDatabaseMigrationError(error)) return databaseMigrationResponse(cors);
    return jsonResponse({ error: "Unable to load services" }, 500, cors.headers);
  }
}

async function handleReserveUsage(request, env, ctx, cors) {
  try {
    const body = await request.json().catch(() => ({}));
    const productCode = String(body.product_code || "");
    const action = String(body.action || "use").slice(0, 80);
    const idempotencyKey = String(body.idempotency_key || "").slice(0, 160);
    if (!['chatbox_ai', 'magazine_export', 'magazine_ai_review'].includes(productCode) || !idempotencyKey) {
      return jsonResponse({ error: "Invalid usage request" }, 400, cors.headers);
    }
    if (ctx.userClaims.role === "admin") {
      const { data, error } = await ctx.supabaseAdmin.from("service_usage").insert({
        user_id: ctx.userClaims.id,
        product_code: productCode,
        action,
        units: 1,
        source: "admin",
        status: "reserved",
        idempotency_key: idempotencyKey,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      }).select("id").single();
      if (error) throw error;
      return jsonResponse({ allowed: true, unlimited: true, reservation_id: data.id, source: "admin" }, 200, cors.headers);
    }
    const { data, error } = await ctx.supabaseAdmin.rpc("reserve_service_usage", {
      p_user_id: ctx.userClaims.id,
      p_product_code: productCode,
      p_action: action,
      p_idempotency_key: idempotencyKey,
      p_metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    });
    if (error) throw error;
    return jsonResponse(data || { allowed: false, reason: "service_unavailable" }, data?.allowed ? 200 : 403, cors.headers);
  } catch (error) {
    console.error("Reserve service usage error", error.message);
    if (isDatabaseMigrationError(error)) return databaseMigrationResponse(cors);
    return jsonResponse({ error: "Unable to reserve service usage" }, 500, cors.headers);
  }
}

async function handleFinalizeUsage(request, env, ctx, cors) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.reservation_id) {
      return jsonResponse({ ok: true, status: body.success === false ? "refunded" : "consumed" }, 200, cors.headers);
    }
    const { data, error } = await ctx.supabaseAdmin.rpc("finalize_service_usage", {
      p_user_id: ctx.userClaims.id,
      p_reservation_id: body.reservation_id,
      p_success: body.success !== false
    });
    if (error) throw error;
    return jsonResponse(data || { ok: false }, data?.ok ? 200 : 404, cors.headers);
  } catch (error) {
    console.error("Finalize service usage error", error.message);
    return jsonResponse({ error: "Unable to finalize service usage" }, 500, cors.headers);
  }
}

async function handleRenewalPreference(request, env, ctx, cors) {
  try {
    const body = await request.json().catch(() => ({}));
    const productCode = String(body.product_code || "");
    const planId = String(body.plan_id || "");
    const enabled = body.enabled === true;
    const { data: plan, error: planError } = await ctx.supabaseAdmin.from("service_plans")
      .select("id, product_code, active").eq("id", planId).eq("product_code", productCode).maybeSingle();
    if (planError) throw planError;
    if (!plan || !plan.active) return jsonResponse({ error: "Plan is unavailable" }, 400, cors.headers);
    const { data, error } = await ctx.supabaseAdmin.from("auto_renew_preferences").upsert({
      user_id: ctx.userClaims.id, product_code: productCode, plan_id: planId, enabled, updated_at: new Date().toISOString()
    }, { onConflict: "user_id,product_code" }).select("product_code, plan_id, enabled").single();
    if (error) throw error;
    return jsonResponse({ preference: data }, 200, cors.headers);
  } catch (error) {
    console.error("Renewal preference error", error.message);
    return jsonResponse({ error: "Unable to update auto renewal" }, 500, cors.headers);
  }
}

function normalizeServicePlanInput(body) {
  const billingType = String(body.billing_type || "");
  const productCode = String(body.product_code || "");
  const durationDays = billingType === "monthly" ? Number(body.duration_days || 30) : null;
  const plan = {
    id: String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80),
    product_code: productCode,
    name: String(body.name || "").trim().slice(0, 120),
    billing_type: billingType,
    price_vnd: Number(body.price_vnd),
    credits: Number(body.credits),
    duration_days: durationDays,
    payment_prefix: String(body.payment_prefix || "CHAT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "CHAT",
    active: body.active !== false,
    sort_order: Number(body.sort_order || 0),
    updated_at: new Date().toISOString()
  };
  const valid = plan.id && plan.name
    && ['chatbox_ai', 'magazine_export', 'magazine_ai_review'].includes(productCode)
    && ['credit_pack', 'monthly'].includes(billingType)
    && Number.isSafeInteger(plan.price_vnd) && plan.price_vnd >= 0
    && Number.isSafeInteger(plan.credits) && plan.credits > 0
    && (billingType !== 'monthly' || (Number.isSafeInteger(durationDays) && durationDays > 0 && durationDays <= 31));
  return valid ? plan : null;
}

async function handleAdminCreateServicePlan(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const plan = normalizeServicePlanInput(await request.json().catch(() => ({})));
    if (!plan) return jsonResponse({ error: "Invalid service plan" }, 400, cors.headers);
    const { data, error } = await ctx.supabaseAdmin.from("service_plans").insert(plan).select().single();
    if (error) throw error;
    return jsonResponse({ plan: data }, 201, cors.headers);
  } catch (error) {
    console.error("Create service plan error", error.message);
    return jsonResponse({ error: "Unable to create service plan" }, 500, cors.headers);
  }
}

async function handleAdminUpdateServicePlan(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const planId = String(body.id || "");
    const { data: existing, error: existingError } = await ctx.supabaseAdmin.from("service_plans")
      .select("id, product_code, billing_type").eq("id", planId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return jsonResponse({ error: "Service plan not found" }, 404, cors.headers);
    const plan = normalizeServicePlanInput({
      ...body,
      id: existing.id,
      product_code: existing.product_code,
      billing_type: existing.billing_type
    });
    if (!plan) return jsonResponse({ error: "Invalid service plan" }, 400, cors.headers);
    delete plan.id;
    const { data, error } = await ctx.supabaseAdmin.from("service_plans")
      .update(plan).eq("id", existing.id).select().single();
    if (error) throw error;
    return jsonResponse({ plan: data }, 200, cors.headers);
  } catch (error) {
    console.error("Update service plan error", error.message);
    return jsonResponse({ error: "Unable to update service plan" }, 500, cors.headers);
  }
}

const LOOKUP_SOURCE_COLUMNS = "id, name, result_url, sample_keyword, url_template, source_type, display_mode, is_active, sort_order, created_by, created_at, updated_at";
const DEFAULT_LOOKUP_SOURCE_SEEDS = [
  {
    name: "Non-APC",
    result_url: "https://noapc.com/journal.php?q=iatreia",
    sample_keyword: "iatreia",
    url_template: "https://noapc.com/journal.php?q={{query}}",
    source_type: "search",
    display_mode: "both",
    is_active: true,
    sort_order: 10
  },
  {
    name: "Resurchify",
    result_url: "https://www.resurchify.com/find/?query=2773+0123#search_results",
    sample_keyword: "2773 0123",
    url_template: "https://www.resurchify.com/find/?query={{query}}#search_results",
    source_type: "search",
    display_mode: "both",
    is_active: true,
    sort_order: 20
  },
  {
    name: "Web Of Science",
    result_url: "https://wos-journal.info/?jsearch=iatreia",
    sample_keyword: "iatreia",
    url_template: "https://wos-journal.info/?jsearch={{query}}",
    source_type: "search",
    display_mode: "both",
    is_active: true,
    sort_order: 30
  }
];

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch (_) {
    return false;
  }
}

function normalizeLookupSourceInput(body, existing = {}) {
  const allowedSourceTypes = new Set(["fixed", "search"]);
  const sourceType = allowedSourceTypes.has(body.source_type) ? body.source_type : "search";
  const displayMode = ["iframe", "link", "both"].includes(body.display_mode) ? body.display_mode : "both";
  const resultUrl = String(body.result_url ?? existing.result_url ?? "").trim();
  const urlTemplate = String(body.url_template ?? existing.url_template ?? resultUrl).trim();
  const source = {
    name: String(body.name ?? existing.name ?? "").trim().slice(0, 120),
    result_url: resultUrl || null,
    sample_keyword: String(body.sample_keyword ?? existing.sample_keyword ?? "").trim().slice(0, 200),
    url_template: urlTemplate,
    source_type: sourceType,
    display_mode: displayMode,
    is_active: body.is_active !== false,
    sort_order: Number.isSafeInteger(Number(body.sort_order)) ? Number(body.sort_order) : 100,
    updated_at: new Date().toISOString()
  };
  const valid = source.name
    && source.url_template
    && isHttpsUrl(source.url_template)
    && (!source.result_url || isHttpsUrl(source.result_url))
    && (source.source_type !== "search" || source.url_template.includes("{{query}}"));
  return valid ? source : null;
}

async function ensureDefaultLookupSources(ctx) {
  const { data: existingRows, error: existingError } = await ctx.supabaseAdmin.from("lookup_sources")
    .select("name");
  if (existingError) throw existingError;
  const existingNames = new Set((existingRows || []).map(row => String(row.name || "").trim().toLowerCase()));
  const missing = DEFAULT_LOOKUP_SOURCE_SEEDS.filter(seed => !existingNames.has(seed.name.toLowerCase()));
  if (!missing.length) return;
  const { error } = await ctx.supabaseAdmin.from("lookup_sources").insert(missing);
  if (error) throw error;
}

async function handleAdminListLookupSources(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    await ensureDefaultLookupSources(ctx);
    const { data, error } = await ctx.supabaseAdmin.from("lookup_sources")
      .select(LOOKUP_SOURCE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return jsonResponse({ sources: (data || []).filter(source => source.source_type !== "journal_checker_widget") }, 200, cors.headers);
  } catch (error) {
    console.error("List lookup sources error", error.message);
    return jsonResponse({ error: "Unable to load lookup sources" }, 500, cors.headers);
  }
}

async function handleAdminCreateLookupSource(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const source = normalizeLookupSourceInput(await request.json().catch(() => ({})));
    if (!source) return jsonResponse({ error: "Nguồn tra cứu không hợp lệ" }, 400, cors.headers);
    source.created_by = ctx.userClaims.id;
    const { data, error } = await ctx.supabaseAdmin.from("lookup_sources")
      .insert(source)
      .select(LOOKUP_SOURCE_COLUMNS)
      .single();
    if (error) throw error;
    return jsonResponse({ source: data }, 201, cors.headers);
  } catch (error) {
    console.error("Create lookup source error", error.message);
    return jsonResponse({ error: "Unable to create lookup source" }, 500, cors.headers);
  }
}

async function handleAdminUpdateLookupSource(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    const { data: existing, error: existingError } = await ctx.supabaseAdmin.from("lookup_sources")
      .select(LOOKUP_SOURCE_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return jsonResponse({ error: "Lookup source not found" }, 404, cors.headers);
    const source = normalizeLookupSourceInput(body, existing);
    if (!source) return jsonResponse({ error: "Nguồn tra cứu không hợp lệ" }, 400, cors.headers);
    const { data, error } = await ctx.supabaseAdmin.from("lookup_sources")
      .update(source)
      .eq("id", id)
      .select(LOOKUP_SOURCE_COLUMNS)
      .single();
    if (error) throw error;
    return jsonResponse({ source: data }, 200, cors.headers);
  } catch (error) {
    console.error("Update lookup source error", error.message);
    return jsonResponse({ error: "Unable to update lookup source" }, 500, cors.headers);
  }
}

async function handleAdminDeleteLookupSource(request, env, ctx, cors, id) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const { error } = await ctx.supabaseAdmin.from("lookup_sources").delete().eq("id", id);
    if (error) throw error;
    return jsonResponse({ deleted: true }, 200, cors.headers);
  } catch (error) {
    console.error("Delete lookup source error", error.message);
    return jsonResponse({ error: "Unable to delete lookup source" }, 500, cors.headers);
  }
}

function requireAdmin(ctx, cors) {
  if (ctx.userClaims?.role === "admin") return null;
  return jsonResponse({ error: "Admin access required" }, 403, cors.headers);
}

async function handlePublicConfig(env, cors) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const admin = getAdminClient(env);
    const [{ data: product, error }, { data: plans, error: planError }] = await Promise.all([
      admin.from("service_products").select("trial_days").eq("code", "chatbox_ai").maybeSingle(),
      admin.from("service_plans").select("price_vnd").eq("product_code", "chatbox_ai").eq("active", true).order("price_vnd").limit(1)
    ]);
    if (error) throw error;
    if (planError) throw planError;
    return jsonResponse({
      trial_days: Number(product?.trial_days ?? 14),
      price_vnd: Number(plans?.[0]?.price_vnd || 0)
    }, 200, cors.headers);
  } catch (error) {
    console.error("Public config error", error.message);
    return jsonResponse({ trial_days: 14, price_vnd: 0 }, 200, cors.headers);
  }
}

async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 1000) break;
  }
  return users;
}

async function handleCleanAdminDashboard(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const [users, paymentsRes, profilesRes, entitlementsRes, usageRes, plansRes, productsRes] = await Promise.all([
      listAllAuthUsers(ctx.supabaseAdmin),
      ctx.supabaseAdmin.from("payments")
        .select("id, user_id, product_code, service_plan_id, payment_code, amount_vnd, status, credits_granted, wallet_amount_vnd, order_type, created_at, paid_at")
        .order("created_at", { ascending: false }),
      ctx.supabaseAdmin.from("profiles").select("user_id, display_name, role"),
      ctx.supabaseAdmin.from("user_entitlements")
        .select("user_id, product_code, credit_balance, monthly_balance, monthly_ends_at, trial_ends_at"),
      ctx.supabaseAdmin.from("service_usage")
        .select("user_id, product_code, action, status, created_at").eq("status", "consumed").order("created_at"),
      ctx.supabaseAdmin.from("service_plans")
        .select("id, product_code, name, billing_type, price_vnd, credits, duration_days, payment_prefix, active, sort_order")
        .order("product_code").order("sort_order"),
      ctx.supabaseAdmin.from("service_products")
        .select("code, name, description, trial_days, trial_daily_limit, active")
        .order("created_at")
    ]);
    for (const result of [paymentsRes, profilesRes, entitlementsRes, usageRes, plansRes, productsRes]) {
      if (result.error) throw result.error;
    }
    const profiles = new Map((profilesRes.data || []).map(row => [row.user_id, row]));
    const entitlements = new Map();
    for (const row of entitlementsRes.data || []) {
      if (!entitlements.has(row.user_id)) entitlements.set(row.user_id, []);
      entitlements.get(row.user_id).push(row);
    }
    const userMap = new Map(users.map(user => [user.id, user]));
    const rows = users.map(user => ({
      id: user.id,
      email: user.email || '',
      name: profiles.get(user.id)?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Người dùng',
      role: profiles.get(user.id)?.role || (user.app_metadata?.role === 'admin' ? 'admin' : 'client'),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      entitlements: entitlements.get(user.id) || []
    }));
    const payments = (paymentsRes.data || []).map(payment => ({
      ...payment,
      email: userMap.get(payment.user_id)?.email || '',
      name: profiles.get(payment.user_id)?.display_name || userMap.get(payment.user_id)?.email?.split('@')[0] || 'Người dùng'
    }));
    const paid = payments.filter(row => row.status === 'paid');
    const paidPlans = paid.filter(row => row.order_type === 'plan_purchase');
    const revenueByProduct = paid.reduce((totals, row) => {
      const key = row.order_type === 'wallet_topup' ? 'wallet_topup' : row.product_code;
      totals[key] = (totals[key] || 0) + Number(row.amount_vnd || 0);
      return totals;
    }, {});
    return jsonResponse({
      metrics: {
        revenue_vnd: paid.reduce((sum, row) => sum + Number(row.amount_vnd || 0), 0),
        vip_users: new Set(paidPlans.map(row => row.user_id)).size,
        ai_uses: (usageRes.data || []).filter(row => row.product_code === 'chatbox_ai').length,
        ai_review_uses: (usageRes.data || []).filter(row => row.product_code === 'magazine_ai_review').length,
        export_uses: (usageRes.data || []).filter(row => row.product_code === 'magazine_export').length,
        total_users: users.length,
        revenue_by_product: revenueByProduct
      },
      users: rows,
      payments,
      service_usage: usageRes.data || [],
      service_plans: plansRes.data || [],
      products: productsRes.data || [],
      plans: []
    }, 200, cors.headers);
  } catch (error) {
    console.error("Clean admin dashboard error", error.message);
    if (isDatabaseMigrationError(error)) return databaseMigrationResponse(cors);
    return jsonResponse({ error: "Unable to load admin dashboard" }, 500, cors.headers);
  }
}

async function handleAdminDashboard(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const [users, paymentsRes, subscriptionsRes, usageRes, plansRes, profilesRes, serviceUsageRes, servicePlansRes, entitlementsRes] = await Promise.all([
      listAllAuthUsers(ctx.supabaseAdmin),
      ctx.supabaseAdmin.from("payments")
        .select("id, user_id, plan_id, service_plan_id, product_code, payment_code, amount_vnd, status, credits_granted, wallet_amount_vnd, order_type, created_at, paid_at")
        .order("created_at", { ascending: false }),
      ctx.supabaseAdmin.from("subscriptions")
        .select("user_id, status, expires_at, ai_credits_remaining, wallet_balance_vnd, trial_started_at, trial_ends_at, plan_id, vip_plans(name, price_vnd, trial_days, daily_ai_limit, ai_credit_amount, ai_wallet_unit_price_vnd)"),
      ctx.supabaseAdmin.from("ai_usage")
        .select("user_id, usage_date, message_count")
        .order("usage_date", { ascending: true }),
      ctx.supabaseAdmin.from("vip_plans")
        .select("id, name, price_vnd, trial_days, daily_ai_limit, ai_credit_amount, ai_wallet_unit_price_vnd, active")
        .order("price_vnd", { ascending: true }),
      ctx.supabaseAdmin.from("profiles")
        .select("user_id, display_name")
        .order("display_name", { ascending: true }),
      ctx.supabaseAdmin.from("service_usage")
        .select("user_id, product_code, action, status, created_at").eq("status", "consumed")
        .order("created_at", { ascending: true }),
      ctx.supabaseAdmin.from("service_plans")
        .select("id, product_code, name, billing_type, price_vnd, credits, duration_days, payment_prefix, active, sort_order")
        .order("product_code").order("sort_order"),
      ctx.supabaseAdmin.from("user_entitlements")
        .select("user_id, product_code, credit_balance, monthly_balance, monthly_ends_at, trial_ends_at")
    ]);
    for (const result of [paymentsRes, subscriptionsRes, usageRes, plansRes, profilesRes, serviceUsageRes, servicePlansRes, entitlementsRes]) {
      if (result.error) throw result.error;
    }
    const { data: adminRows, error: adminUsersError } = await ctx.supabaseAdmin.from("admin_users")
      .select("email");
    if (adminUsersError) console.error("Admin users lookup failed", adminUsersError.message);
    const adminEmailSet = new Set((adminRows || []).map(row => String(row.email || "").toLowerCase()));

    const now = new Date();
    const paidPayments = (paymentsRes.data || []).filter(row => row.status === "paid");
    const paidPlanPayments = paidPayments.filter(row => row.order_type !== 'wallet_topup');
    const paymentsByUser = new Map();
    for (const payment of paidPayments) {
      if (!paymentsByUser.has(payment.user_id)) paymentsByUser.set(payment.user_id, []);
      paymentsByUser.get(payment.user_id).push(payment);
    }
    const usageByUser = new Map();
    for (const usage of usageRes.data || []) {
      if (!usageByUser.has(usage.user_id)) usageByUser.set(usage.user_id, []);
      usageByUser.get(usage.user_id).push(usage);
    }
    const userById = new Map(users.map(user => [user.id, user]));
    const profileById = new Map((profilesRes.data || []).map(row => [row.user_id, row]));
    const subscriptionById = new Map((subscriptionsRes.data || []).map(row => [row.user_id, row]));
    const entitlementsByUser = new Map();
    for (const entitlement of entitlementsRes.data || []) {
      if (!entitlementsByUser.has(entitlement.user_id)) entitlementsByUser.set(entitlement.user_id, []);
      entitlementsByUser.get(entitlement.user_id).push(entitlement);
    }
    const rows = users.map(user => {
      const subscription = subscriptionById.get(user.id) || null;
      const profile = profileById.get(user.id);
      const role = user.app_metadata?.role === "admin" || adminEmailSet.has(String(user.email || "").toLowerCase()) ? "admin" : "user";
      const paidAccess = paidAccessFromDatabase({
        payments: paymentsByUser.get(user.id) || [],
        subscription
      });
      const displaySubscription = subscription ? {
        ...subscription,
        ai_credits_remaining: paidAccess.remainingCredits,
        wallet_balance_vnd: paidAccess.walletBalance,
        status: paidAccess.paidActive ? "active" : subscription.status
      } : null;
      const isAdmin = role === "admin";
      const isTrial = Boolean(!isAdmin && !paidAccess.paidActive && !paidAccess.hasPaid
        && subscription?.trial_ends_at && new Date(subscription.trial_ends_at) > now);
      return {
        id: user.id,
        email: user.email || "",
        name: profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "Người dùng",
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        role,
        is_vip: isAdmin || paidAccess.paidActive,
        is_trial: isTrial,
        subscription: displaySubscription,
        entitlements: entitlementsByUser.get(user.id) || []
      };
    });
    const payments = (paymentsRes.data || []).map(payment => ({
      ...payment,
      email: userById.get(payment.user_id)?.email || "",
      name: profileById.get(payment.user_id)?.display_name
        || userById.get(payment.user_id)?.user_metadata?.display_name
        || userById.get(payment.user_id)?.email?.split("@")[0] || "Người dùng"
    }));
    const revenueByProduct = paidPayments.reduce((totals, payment) => {
      const key = payment.order_type === 'wallet_topup' ? 'wallet_topup' : (payment.product_code || 'chatbox_ai');
      totals[key] = (totals[key] || 0) + Number(payment.amount_vnd || 0);
      return totals;
    }, {});

    return jsonResponse({
      metrics: {
        revenue_vnd: paidPayments.reduce((sum, row) => sum + Number(row.amount_vnd || 0), 0),
        vip_users: new Set(paidPlanPayments.map(row => row.user_id)).size,
        ai_uses: (serviceUsageRes.data || []).filter(row => row.product_code === 'chatbox_ai').length,
        ai_review_uses: (serviceUsageRes.data || []).filter(row => row.product_code === 'magazine_ai_review').length,
        export_uses: (serviceUsageRes.data || []).filter(row => row.product_code === 'magazine_export').length,
        total_users: users.length,
        revenue_by_product: revenueByProduct
      },
      users: rows,
      payments,
      usage: usageRes.data || [],
      plans: plansRes.data || [],
      service_usage: serviceUsageRes.data || [],
      service_plans: servicePlansRes.data || []
    }, 200, cors.headers);
  } catch (error) {
    console.error("Admin dashboard error", error.message);
    return jsonResponse({ error: "Unable to load admin dashboard" }, 500, cors.headers);
  }
}

async function handleAdminSettings(request, env, ctx, cors) {
  const denied = requireAdmin(ctx, cors);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const trialEnabled = body.trial_enabled !== false;
    const trialDays = trialEnabled ? Number(body.trial_days) : 0;
    const chatDailyLimit = trialEnabled ? Number(body.chat_daily_limit) : 0;
    const reviewDailyLimit = trialEnabled ? Number(body.review_daily_limit) : 0;
    const validDays = Number.isSafeInteger(trialDays) && trialDays >= 0 && trialDays <= 365;
    const validChatLimit = Number.isSafeInteger(chatDailyLimit) && chatDailyLimit >= 0 && chatDailyLimit <= 9999;
    const validReviewLimit = Number.isSafeInteger(reviewDailyLimit) && reviewDailyLimit >= 0 && reviewDailyLimit <= 9999;
    if (!validDays || !validChatLimit || !validReviewLimit
      || (trialEnabled && (trialDays < 1 || chatDailyLimit < 1 || reviewDailyLimit < 1))) {
      return jsonResponse({ error: "Giá trị dùng thử chưa hợp lệ" }, 400, cors.headers);
    }

    const updates = [
      ctx.supabaseAdmin.from("service_products")
        .update({ trial_days: trialDays, trial_daily_limit: chatDailyLimit })
        .eq("code", "chatbox_ai"),
      ctx.supabaseAdmin.from("service_products")
        .update({ trial_days: trialDays, trial_daily_limit: reviewDailyLimit })
        .eq("code", "magazine_ai_review")
    ];
    const updateResults = await Promise.all(updates);
    for (const result of updateResults) {
      if (result.error) throw result.error;
    }

    let syncedTrials = 0;
    const productLimits = [
      ["chatbox_ai", chatDailyLimit],
      ["magazine_ai_review", reviewDailyLimit]
    ];
    for (const [productCode, dailyLimit] of productLimits) {
      let query = ctx.supabaseAdmin.from("user_entitlements")
        .update({
          trial_daily_limit: dailyLimit,
          trial_ends_at: trialEnabled ? new Date(Date.now() + trialDays * 86400000).toISOString() : new Date().toISOString()
        })
        .eq("product_code", productCode)
        .gt("trial_ends_at", new Date().toISOString());
      const { data, error } = await query.select("user_id");
      if (error) throw error;
      syncedTrials += data?.length || 0;
    }

    const { data: products, error: productError } = await ctx.supabaseAdmin.from("service_products")
      .select("code, name, description, trial_days, trial_daily_limit, active")
      .order("created_at");
    if (productError) throw productError;
    return jsonResponse({ products: products || [], synced_trials: syncedTrials }, 200, cors.headers);
  } catch (error) {
    console.error("Admin settings error", error.message);
    return jsonResponse({ error: "Unable to save admin settings" }, 500, cors.headers);
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
    order_type: order.order_type || "plan_purchase",
    product_code: order.product_code || null,
    plan_id: order.service_plan_id || order.plan_id || null,
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

    const body = await request.json().catch(() => ({}));
    const orderType = String(body.order_type || "plan_purchase");
    const topupAmount = Number(body.amount_vnd || 0);
    const requestedPlanId = String(body.plan_id || "");
    let plan = null;
    if (orderType === "plan_purchase") {
      const { data, error } = await ctx.supabaseAdmin.from("service_plans")
        .select("id, product_code, name, price_vnd, credits, billing_type, duration_days, payment_prefix, active")
        .eq("id", requestedPlanId).eq("active", true).maybeSingle();
      if (error) throw error;
      plan = data;
    }
    if (orderType === "plan_purchase" && !plan) return jsonResponse({ error: "Service plan is unavailable" }, 503, cors.headers);
    if (!["wallet_topup", "plan_purchase"].includes(orderType)) {
      return jsonResponse({ error: "Invalid order type" }, 400, cors.headers);
    }
    if (orderType === "wallet_topup"
      && (!Number.isSafeInteger(topupAmount) || topupAmount < 1000 || topupAmount > 5000000)) {
      return jsonResponse({ error: "Invalid top-up amount" }, 400, cors.headers);
    }

    const now = new Date().toISOString();
    const { error: cleanupError } = await ctx.supabaseAdmin.from("payments")
      .delete()
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("expires_at", now);
    if (cleanupError) throw cleanupError;

    let pendingQuery = ctx.supabase.from("payments")
      .select("id, payment_code, amount_vnd, status, order_type, expires_at, product_code, service_plan_id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("order_type", orderType)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1);
    if (orderType === "plan_purchase") pendingQuery = pendingQuery.eq("service_plan_id", plan.id);
    const { data: pending, error: pendingError } = await pendingQuery;
    if (pendingError) throw pendingError;

    if (pending?.[0]) return jsonResponse(orderPayload(pending[0], env), 200, cors.headers);

    const payment = {
      user_id: userId,
      amount_vnd: orderType === "wallet_topup" ? topupAmount : plan.price_vnd,
      payment_code: randomPaymentCode(plan?.payment_prefix || 'WALLET'),
      status: "pending",
      order_type: orderType,
      product_code: orderType === "plan_purchase" ? plan.product_code : null,
      service_plan_id: orderType === "plan_purchase" ? plan.id : null
    };

    // Tạo đơn thanh toán với admin client (vượt qua RLS của payments)
    const { data: inserted, error: insertError } = await ctx.supabaseAdmin.from("payments")
      .insert(payment)
      .select("id, payment_code, amount_vnd, status, order_type, expires_at, product_code, service_plan_id");
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

async function handleCancelOrder(request, env, ctx, cors, code) {
  if (!cors.originAllowed) return jsonResponse({ error: "Origin not allowed" }, 403, cors.headers);
  try {
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonResponse({ error: "Authentication required" }, 401, cors.headers);

    // Never remove a completed transaction, including when webhook and close
    // requests reach the Worker at nearly the same time.
    const { error } = await ctx.supabaseAdmin.from("payments")
      .delete()
      .eq("user_id", userId)
      .eq("payment_code", code)
      .eq("status", "pending");
    if (error) throw error;
    return jsonResponse({ cancelled: true }, 200, cors.headers);
  } catch (error) {
    console.error("Cancel order error", error.message);
    return jsonResponse({ error: "Unable to cancel payment order" }, 500, cors.headers);
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

export async function verifySepaySignature(rawBody, request, secret) {
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
  const authMode = String(env.SEPAY_WEBHOOK_AUTH || "hmac").trim().toLowerCase();
  const signature = request.headers.get("X-SePay-Signature");
  const timestamp = request.headers.get("X-SePay-Timestamp");
  if (authMode === "hmac") {
    return Boolean(env.SEPAY_WEBHOOK_SECRET)
      && Boolean(signature && timestamp)
      && await verifySepaySignature(rawBody, request, env.SEPAY_WEBHOOK_SECRET);
  }

  if (authMode !== "api_key") return false;
  const authorization = request.headers.get("Authorization") || "";
  const apiKeyMatch = authorization.match(/^Apikey\s+(.+)$/i);
  const expectedApiKey = env.SEPAY_WEBHOOK_API_KEY;
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
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  };
  if (request.method !== "POST") return jsonResponse({ success: false }, 405, secureHeaders);

  const serviceKey = env.SUPABASE_SECRET_KEY;
  const authMode = String(env.SEPAY_WEBHOOK_AUTH || "hmac").trim().toLowerCase();
  const hasWebhookCredential = authMode === "hmac"
    ? Boolean(env.SEPAY_WEBHOOK_SECRET)
    : authMode === "api_key" && Boolean(env.SEPAY_WEBHOOK_API_KEY);
  if (!hasWebhookCredential || !env.SUPABASE_URL || !serviceKey) {
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

    // Dashboard "Gửi thử" uses mock transaction id 0. Authentication has
    // already passed, so acknowledge it without touching payment state.
    if (String(payload.id) === "0") {
      return jsonResponse({ success: true }, 200, secureHeaders);
    }

    // Authenticated incoming transactions unrelated to a CHAT order are not
    // errors and must not be retried by SePay.
    if (incoming && !paymentCode) {
      return jsonResponse({ success: true }, 200, secureHeaders);
    }

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
