> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 08. Container hóa ứng dụng (Docker & Environment)

Tài liệu này đặc tả thiết kế môi trường chạy ảo hóa (Containerization) của hệ thống bằng Docker và Docker Compose, cũng như khai báo các biến cấu hình hệ thống.

---

## 1. Thiết kế Dockerfile cho Node.js App (Dockerfile)

Dockerfile của ứng dụng Node.js được thiết kế theo dạng **multi-stage build** để tối ưu hóa kích thước image và nâng cao độ an toàn bảo mật.

```dockerfile
# Stage 1: Build & Cài đặt dependencies
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --only=production

# Stage 2: Runtime Production
FROM node:20-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

# Đảm bảo phân quyền không chạy bằng root user để tăng tính bảo mật
USER node

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
```

---

## 2. Thiết kế Docker Compose (docker-compose.yml)

Docker Compose quản lý khởi chạy hai dịch vụ local phục vụ việc phát triển và kiểm thử: Cơ sở dữ liệu MySQL và Vector DB Qdrant.

```yaml
version: '3.8'

services:
  # 1. Cơ sở dữ liệu MySQL 8.0
  db:
    image: mysql:8.0
    container_name: vtc_mysql_db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: vtc_rag_db
      MYSQL_USER: vtc_user
      MYSQL_PASSWORD: vtc_password
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./src/database/schema.sql:/docker-entrypoint-initdb.d/1_schema.sql
      - ./src/database/seed.sql:/docker-entrypoint-initdb.d/2_seed.sql
    networks:
      - vtc_network

  # 2. Vector DB Qdrant (Hỗ trợ nhóm RAG/Python)
  qdrant:
    image: qdrant/qdrant:latest
    container_name: vtc_qdrant_db
    restart: always
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - vtc_network

volumes:
  mysql_data:
    driver: local
  qdrant_data:
    driver: local

networks:
  vtc_network:
    driver: bridge
```

---

## 3. Bản khai báo biến môi trường mẫu (.env.example)

```env
# 1. Server Configuration
PORT=5000
NODE_ENV=development

# 2. Relational Database (MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=vtc_rag_db
DB_USER=vtc_user
DB_PASSWORD=vtc_password

# 3. Security (JWT)
JWT_SECRET=super_secret_key_change_me_in_production_123456789
JWT_EXPIRES_IN=7d

# 4. RAG Integration (Python Service & Qdrant)
QDRANT_HOST=localhost
QDRANT_PORT=6333
PYTHON_RAG_SERVICE_URL=http://localhost:8000

# 5. File Upload Config
UPLOAD_DIR=uploads
```
