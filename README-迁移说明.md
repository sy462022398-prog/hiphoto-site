# 嗨拍摄影俱乐部 - 网站迁移说明

## 包内容

```
├── src/                    前端全部源码（React 19 + Vite + TS + Tailwind v4）
├── migrations/             数据库建表与 RLS 权限 SQL（4 个文件）
├── data.sql                数据库数据导出（activities 59 条 + media 877 条 INSERT）
├── scripts/ batch-upload.mjs retry-upload.mjs   批量上传辅助脚本
├── index.html package.json pnpm-lock.yaml ...   工程配置
└── .env                    Supabase 连接配置（迁移后需替换成新项目的地址和密钥）
```

## 迁移步骤

1. **安装依赖并本地运行**
   ```bash
   pnpm install
   pnpm run dev      # 开发预览
   pnpm run build    # 生产构建（产物在 dist/）
   ```

2. **准备新的 Supabase（或任意 PostgreSQL）项目**
   - 依次执行 `migrations/` 下 4 个 SQL：建 activities 表 → 建 media 表 → 配置 RLS → 补充删除权限
   - 执行 `data.sql` 导入全部活动和作品记录

3. **替换连接配置**
   - 修改 `.env` 中的 Supabase URL 与 anon key 为新项目的值
   - 同步修改 `src/supabase/client.ts` 中的地址

4. **迁移媒体文件（重要）**
   - `data.sql` 和表记录中的 `file_url` / `cover_url` 指向原存储域名
     `https://jush29fyenv9x5o1.database.meoo.xyz/storage/v1/object/public/photos/...`
   - 若原存储桶继续可用，无需任何处理，图片照常显示
   - 若原存储桶会下线，需从原 Supabase Storage 的 `photos` 桶下载全部文件，
     上传到新项目的同名桶，然后批量替换 URL 域名：
     ```sql
     UPDATE activities SET cover_url = replace(cover_url, '旧域名', '新域名');
     UPDATE media SET file_url = replace(file_url, '旧域名', '新域名'),
                      thumbnail_url = replace(thumbnail_url, '旧域名', '新域名');
     ```

## 访问凭据

- 前台访问密码：`aihaipai`（src/components/PasswordGate.tsx）
- 后台管理员：`shiyun` / `shiyun960210`（src/components/ProtectedRoute.tsx）
- 迁移后建议修改以上凭据
