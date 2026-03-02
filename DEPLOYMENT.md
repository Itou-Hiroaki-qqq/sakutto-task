# デプロイメントガイド

## 環境変数の設定

Vercelダッシュボードで以下の環境変数を設定してください：

### 必須環境変数

- `DATABASE_URL`: Neonデータベースの接続URL
- `NEXT_PUBLIC_SUPABASE_URL`: SupabaseプロジェクトのURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Anon Key
- `RESEND_API_KEY`: Resend APIキー
- `RESEND_FROM_EMAIL`: 送信元メールアドレス（例: `Sakutto Task <noreply@yourdomain.com>`）
- `CRON_SECRET`: Cron認証用の秘密鍵（ランダムな文字列）

### 任意環境変数

- `GEMINI_API_KEY`: 予定表AI解析機能を使用する場合に必要

**注意**: すべての環境変数で、Production、Preview、Developmentすべてにチェックを入れてください。

## 通知システム（cron-job.org）

通知は [cron-job.org](https://cron-job.org) を使って5分ごとにエンドポイントを呼び出す仕組みです。

### cron-job.org の設定

| 項目 | 設定値 |
|------|--------|
| URL | `https://your-project.vercel.app/api/cron/notifications` |
| Request method | `POST` |
| 実行間隔 | 5分ごと |
| Header name | `Authorization` |
| Header value | `Bearer (CRON_SECRETの値)` |

- 通知時刻は日本時間（JST）で設定・管理されます
- メール通知をサポートしています（Resend経由）

## トラブルシューティング

### 通知が届かない場合

1. cron-job.orgのログを確認
   - ジョブ一覧から対象ジョブの実行履歴を確認
   - ステータスが200以外の場合は認証エラーまたはサーバーエラーの可能性があります

2. Vercelのログを確認
   - Vercelダッシュボードの「Functions」タブからログを確認
   - エラーメッセージがないか確認

3. 通知設定を確認
   - 通知設定ページで、メール通知が有効になっているか確認
   - タスクの通知時刻が正しく設定されているか確認
