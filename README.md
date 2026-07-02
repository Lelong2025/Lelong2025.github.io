# Tra cứu Tạp chí — Full-stack

- Frontend: GitHub Pages
- Backend API: Node.js trên Render (`tapchi-worker/`)
- Database/Auth: Supabase

## Render

Tạo Web Service với Root Directory `tapchi-worker`, Build Command `npm install`, Start Command `npm start`, Health Check `/`. Nhập các biến backend trong `.env.example` vào Render Environment; không upload `.env`.

## GitHub Pages

Trong Actions Variables, tạo `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, và `NEXT_PUBLIC_API_URL` trỏ đến Render. Chọn Pages Source là GitHub Actions. Workflow sẽ sinh `config.js` và deploy frontend.

## Local

Sao chép `.env.example` thành `.env.local`, điền cấu hình public rồi chạy `npm run build:config`. Với backend, tạo `tapchi-worker/.env`, sau đó chạy `cd tapchi-worker`, `npm install`, `npm start`.

Không đặt `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY` hoặc secret SePay trong biến `NEXT_PUBLIC_*`. `ALLOWED_ORIGINS` trên Render phải chứa chính xác origin GitHub Pages. Bật RLS cho mọi bảng Supabase public. Webhook SePay là `https://<render-domain>/hooks/sepay-payment`.
