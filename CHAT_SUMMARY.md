# さくっとタスク - 開発履歴サマリー

## プロジェクト概要
カレンダーと毎日のtodoリストが一体化したWebアプリケーション
- Next.js 16.1.1
- Supabase (認証)
- Neon Database (PostgreSQL)
- Vercel (ホスティング)
- GitHub Actions (Cron実行)

## 実装した主要機能

### 1. 繰り返しタスク機能
- 毎日、毎週、毎月、毎年の繰り返し
- 指定曜日の繰り返し
- カスタム期間（日/週/月/年おき）
- カスタム単位の実装（特に月/年の繰り返しで指定日を保持）

### 2. タスク削除機能
- 通常タスクの削除
- 繰り返しタスクの削除オプション
  - 「このタスクのみ削除」（特定の日付のみ除外）
  - 「これ以降の繰り返しタスクすべてを削除」（指定日以降を除外）
- task_exclusionsテーブルを使用

### 3. タスク表示の優先順位
1. 時間表示が含まれるタスク（時間順）
2. 繰り返し設定があるタスク（作成順）
3. その他のタスク（作成順）

### 4. タイトル入力の時間変換機能
- 「900」「1425」などの数値入力を「9:00」「14:25」に変換
- 3桁、4桁の数値に対応
- 変換候補の表示とクリック適用

### 5. 通知システム（メール + Web Push）
- Resendを使用したメール通知
- Web Push通知（Service Worker使用）
- GitHub Actionsによる5分ごとのCron実行
- 日本時間（JST）での通知時刻管理
- 通知時刻入力は5分刻みに制限

### 6. その他の改善
- タスク編集後の日付パラメータ保持
- Suspenseバウンダリの追加（useSearchParams対応）
- ノーインデックス設定（robots.txt + metaタグ）

## データベーススキーマ

### 主要テーブル
- `tasks`: タスク情報
- `task_recurrences`: 繰り返し設定
- `task_exclusions`: 繰り返しタスクの除外日
- `user_notification_settings`: ユーザー通知設定
- `web_push_subscriptions`: Web Push購読情報

### 重要なカラム
- `task_recurrences.custom_unit`: カスタム繰り返しの単位（days, weeks, months, years）
- `task_exclusions.exclusion_type`: 除外タイプ（single, after）

## 環境変数設定

### Vercel環境変数
- `DATABASE_URL`: Neonデータベース接続URL
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Anon Key
- `RESEND_API_KEY`: Resend APIキー
- `RESEND_FROM_EMAIL`: 送信元メールアドレス（独自ドメインのメールアドレス）
- `WEB_PUSH_VAPID_PUBLIC_KEY`: VAPID公開鍵
- `WEB_PUSH_VAPID_PRIVATE_KEY`: VAPID秘密鍵
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`: VAPID公開鍵（クライアント用）
- `CRON_SECRET`: Cron認証用秘密鍵

**注意**: すべての環境変数で、Production、Preview、Developmentすべてにチェックを入れる

### GitHub Secrets
- `VERCEL_URL`: VercelのデプロイURL（例: `https://your-project.vercel.app`）
- `CRON_SECRET`: Vercelと同じ値

## DNS設定（Resend用）

独自ドメイン（itohiroaki.com）を使用する場合のDNS設定：

### TXTレコード（Domain Verification）
- Name: `@`
- Value: Resendが提供する値

### TXTレコード（DKIM）
- Name: `resend._domainkey`
- Value: Resendが提供する値

### TXTレコード（SPF）
- Name: `send`
- Value: `v=spf1 include:amazonses.com ~all`

### MXレコード
- Name: `send`
- Value: `feedback-smtp.ap-northeast-1.amazonses.com`
- Priority: `10`

### TXTレコード（DMARC、オプション）
- Name: `_dmarc`
- Value: `v=DMARC1; p=none;`

## 重要な技術的な決定

### 1. タイムゾーン処理
- GitHub ActionsはUTCで実行
- Cronエンドポイントで日本時間（JST）に変換
- `date-fns-tz`の`toZonedTime`を使用

### 2. Cron実行
- Vercelの無料プランでは1日1回のみの制限
- GitHub Actions（無料）を使用して5分ごとに実行
- `.github/workflows/cron-notifications.yml`で設定

### 3. 通知時刻の制限
- Cronが5分ごとに実行されるため、通知時刻は5分刻みに制限
- HTML5の`time`入力に`step="300"`を設定
- `onBlur`イベントで自動的に5分刻みに丸める

### 4. Next.js 16の変更対応
- `useSearchParams()`はSuspenseバウンダリでラップ必須
- `/task`, `/top`, `/weekly`ページで実装

## トラブルシューティングで解決した問題

1. **カスタム繰り返しの月/年処理**
   - 問題: 月/年の繰り返しで指定日がずれる
   - 解決: `custom_unit`カラムを追加し、元の日付を基準に計算

2. **Vercel Cronの制限**
   - 問題: 無料プランでは1日1回のみ
   - 解決: GitHub Actionsに移行

3. **タイムゾーンの不一致**
   - 問題: UTCとJSTの混在で通知が送信されない
   - 解決: CronエンドポイントでJSTに変換

4. **useSearchParamsのエラー**
   - 問題: Next.js 16でSuspenseバウンダリが必要
   - 解決: 各ページでSuspenseでラップ

## ファイル構成

### 主要な実装ファイル
- `src/app/task/page.tsx`: タスク編集ページ
- `src/app/top/page.tsx`: トップページ（カレンダー + TODOリスト）
- `src/app/weekly/page.tsx`: 週間ビュー
- `src/lib/tasks.ts`: タスク取得・処理ロジック
- `src/lib/notifications.ts`: 通知送信ロジック
- `src/app/api/cron/notifications/route.ts`: Cronエンドポイント
- `.github/workflows/cron-notifications.yml`: GitHub Actionsワークフロー

### データベーススキーマファイル
- `src/lib/schema.sql`: 基本スキーマ
- `src/lib/schema_update.sql`: custom_unit追加
- `src/lib/schema_notifications.sql`: 通知関連テーブル
- `src/lib/schema_task_exclusions.sql`: タスク除外テーブル

## デプロイ手順

1. Vercelでプロジェクトを作成
2. GitHubリポジトリと連携
3. 環境変数を設定
4. GitHub Secretsを設定
5. デプロイ実行

詳細は`DEPLOYMENT.md`を参照

## 運用上の注意点

1. **通知システム**
   - GitHub Actionsが5分ごとに実行されることを確認
   - エラーが発生した場合はGitHub Actionsのログを確認
   - Vercelのログも確認可能

2. **データベース**
   - Neonデータベースのバックアップ設定を推奨

3. **環境変数**
   - すべての環境変数が正しく設定されているか定期的に確認

## 今後の改善候補

1. エラーハンドリングの改善
   - 通知送信失敗時のリトライ機能
   - エラーログの集約（Sentryなど）

2. パフォーマンスの最適化
   - 通知送信のバッチ処理
   - データベースクエリの最適化

3. 監視とアラート
   - 通知送信失敗時のアラート
   - GitHub Actionsの失敗通知

4. コードの整理
   - 型定義の統一
   - 定数の外部化
   - 関数の分割（必要に応じて）

## 作成日
2026年1月11日
