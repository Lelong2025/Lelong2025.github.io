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

Không đặt `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY` hoặc secret SePay trong biến `NEXT_PUBLIC_*`. `ALLOWED_ORIGINS` trên Render phải chứa chính xác origin GitHub Pages. Webhook SePay là `https://<render-domain>/hooks/sepay-payment`.

## Hardening production

1. Chạy `database/security-hardening.sql` một lần trong Supabase SQL Editor để bật/siết RLS và loại bỏ cơ chế cấp VIP theo email.
2. Chạy `database/free-trial.sql` để kích hoạt trial một lần, bắt đầu ở lần đăng nhập đầu tiên. Admin có thể chỉnh số ngày trial (1–365) trong Settings; thay đổi chỉ áp dụng cho trial bắt đầu sau đó.
3. Chạy `database/vip-credits.sql` để chuyển VIP trả phí sang cơ chế lượt dùng: thanh toán gói sẽ cộng lượt, nạp số dư sẽ cộng tiền vào ví; mỗi tin nhắn AI trừ lượt trước, khi hết lượt hệ thống chỉ dùng số dư để tự gia hạn thêm một gói VIP theo giá gói hiện tại.
4. Trong SePay Webhook > Security, chọn HMAC-SHA256 và tạo secret ngẫu nhiên 32–64 ký tự.
5. Trên Render > Environment nhập từng biến theo dạng Key/Value: key `SEPAY_WEBHOOK_AUTH` có value `hmac`; key `SEPAY_WEBHOOK_SECRET` có value là cùng chuỗi secret 32–64 ký tự đã dán trong SePay Webhook Security; xóa `SEPAY_WEBHOOK_API_KEY` cũ.
6. Chạy `cd tapchi-worker && npm test` trước khi deploy.
