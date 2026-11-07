
export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      GEMINI_API_KEY,
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    } = process.env;

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({
        error: "Server environment variables missing"
      });
    }

    // 验证登录令牌
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        error: "请先登录"
      });
    }

    const authResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "登录已过期，请重新登录"
      });
    }

    // 检查图片
    const { image, mimeType } = req.body || {};

    if (!image || !mimeType) {
      return res.status(400).json({
        error: "请上传商品照片"
      });
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        error: "只支持 JPG、PNG、WEBP 图片"
      });
    }

    // 限制图片大小：约 5 MB
    const base64 = image.replace(/^data:image\/\w+;base64,/, "");

    if (base64.length > 7 * 1024 * 1024) {
      return res.status(413).json({
        error: "图片太大，请压缩后再上传"
      });
    }

    // 调用 Gemini
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `你是商品资料识别助手。
请识别图片中的商品，只返回 JSON，不要 Markdown。

格式：
{
  "name": "",
  "brand": "",
  "model": "",
  "specification": "",
  "category": "",
  "barcode": "",
  "confidence": "low"
}

规则：
1. 看不清楚的字段返回空字符串。
2. 不允许猜测条码、品牌和型号。
3. confidence 只能是 low、medium、high。
4. 不要生成价格、售价、库存。
5. 如果图片不是商品，所有字段留空。`
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1
          }
        })
      }
    );

    const aiData = await aiResponse.json();

    if (!aiResponse.ok) {
      console.error("Gemini API error:", aiData);
      return res.status(502).json({
        error: "AI 识别服务暂时不可用"
      });
    }

    const text = aiData.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

    if (!text) {
      return res.status(502).json({
        error: "AI 没有返回识别结果"
      });
    }

    const product = JSON.parse(text);

    return res.status(200).json({
      success: true,
      product
    });

  } catch (error) {
    console.error("Recognize error:", error);

    return res.status(500).json({
      error: "商品识别失败，请重试"
    });
  }
}
