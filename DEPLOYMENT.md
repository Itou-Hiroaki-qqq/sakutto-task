# デプロイメントガイド

## 環境変数の設定

Vercelダッシュボードで以下の環境変数を設定してください：

### 必須環境変数

- `DATABASE_URL`: Neonデータベースの接続URL
- `NEXT_PUBLIC_SUPABASE_URL`: SupabaseプロジェクトのURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Anon Key
- `RESEND_API_KEY`: Resend APIキー
- `RESEND_FROM_EMAIL`: 送信元メールアドレス（例: `Sakutto Task <noreply@yourdomain.com>`）
- `WEB_PUSH_VAPID_PUBLIC_KEY`: Web Push VAPID公開鍵
- `WEB_PUSH_VAPID_PRIVATE_KEY`: Web Push VAPID秘密鍵
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`: Web Push VAPID公開鍵（クライアント用、上記と同じ値）
- `CRON_SECRET`: Cron認証用の秘密鍵（ランダムな文字列）

**注意**: すべての環境変数で、Production、Preview、Developmentすべてにチェックを入れてください。

## GitHub Secretsの設定

GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」で以下を設定：

- `VERCEL_URL`: VercelのデプロイURL（例: `https://your-project.vercel.app`）
- `CRON_SECRET`: 上記の`CRON_SECRET`と同じ値

## 通知システム

- GitHub Actionsが5分ごとに自動実行され、通知をチェックします
- 通知時刻は日本時間（JST）で設定・管理されます
- メール通知とWeb Push通知の両方をサポートしています

## トラブルシューティング

### 通知が届かない場合

1. GitHub Actionsのログを確認
   - リポジトリの「Actions」タブから最新のワークフロー実行を確認
   - `emailCount`と`webPushCount`が0の場合は、通知時刻が一致していない可能性があります

2. Vercelのログを確認
   - Vercelダッシュボードの「Functions」タブからログを確認
   - エラーメッセージがないか確認

3. 通知設定を確認
   - 通知設定ページで、メール通知またはWeb Push通知が有効になっているか確認
   - タスクの通知時刻が正しく設定されているか確認
