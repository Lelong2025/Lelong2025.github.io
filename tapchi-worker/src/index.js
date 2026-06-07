export default {
  async fetch(request, env) {
    // Xử lý CORS Preflight (OPTIONS)
    const origin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
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

    try {
      const body = await request.json();
      const { messages, contextData } = body;

      if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: "Invalid request payload. 'messages' array is required." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
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
3. Khi người dùng hỏi về một tạp chí cụ thể, ví dụ "Tạp chí khoa học lạc hồng issn 2525-2186": Hãy trích xuất thông tin từ dữ liệu cục bộ bên trên (nếu có) và trình bày thật mạch lạc: Tên tạp chí, chỉ số ISSN, cơ quan/trường xuất bản, điểm HĐGSNN hoặc các chỉ số quốc tế tương ứng.`;

      // Tạo mảng tin nhắn gửi tới OpenAI
      const openAiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];

      // Gọi OpenAI API
      const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
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
        return new Response(JSON.stringify({ error: `OpenAI API returned error: ${openAiResponse.statusText}`, details: errText }), {
          status: openAiResponse.status,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const openAiData = await openAiResponse.json();
      const reply = openAiData.choices[0].message.content;

      return new Response(JSON.stringify({ result: reply }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err) {
      console.error("Worker Error:", err.message);
      return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
