# さくっとタスク

カレンダーと毎日の Todo が一体化した Web アプリケーションです。  
タスク管理・繰り返し予定・記念日・メール通知・予定表の AI 読み込みなど、実務で使いやすい機能を備えています。

## 主な機能

- **タスク管理** … 日付ごとの Todo 一覧、完了チェック、期日・通知時刻の設定
- **繰り返し予定** … 毎日／毎週／毎月／曜日指定／カスタム間隔に対応。「この予定のみ」／「これ以降すべて」の編集スコープ選択
- **記念日** … 繰り返し対応の記念日をカレンダーに表示
- **メール通知** … 指定時刻にタスクリマインダーを送信（cron 5 分間隔、日本時間）
- **週間ビュー** … 1 週間分のタスクを一覧表示
- **予定表の読み込み** … 画像・PDF の予定表を AI（Gemini）で解析し、タスクとして取り込み
- **検索** … タスクの全文検索

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript 5 |
| UI | React 19, Tailwind CSS 4, DaisyUI |
| 認証 | Supabase Auth |
| データベース | Neon (PostgreSQL, serverless) |
| メール | Resend |
| AI | Google Gemini API（予定表解析） |

## 必要な環境

- Node.js 18+
- npm / yarn / pnpm のいずれか

## セットアップ

### 1. リポジトリのクローンと依存関係のインストール

```bash
git clone <リポジトリURL>
cd sakutto-task
npm install
```

### 2. 環境変数の設定

プロジェクトルートに `.env.local` を作成し、以下を設定してください。

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | Neon PostgreSQL の接続 URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key |
| `RESEND_API_KEY` | Resend API キー（メール送信用） |
| `RESEND_FROM_EMAIL` | 送信元メール（例: `Sakutto Task <noreply@example.com>`） |
| `CRON_SECRET` | 通知 Cron 用の認証シークレット |
| `GEMINI_API_KEY` | 予定表 AI 解析用（任意） |

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。未ログイン時は `/login` にリダイレクトされます。

### ビルド・本番起動

```bash
npm run build
npm start
```

## ディレクトリ構成（抜粋）

```
src/
├── app/
│   ├── api/           # タスク・記念日・通知・予定表解析などの API
│   ├── top/            # メインのタスク一覧（カレンダー＋Todo）
│   ├── task/           # タスクの新規作成・編集
│   ├── weekly/         # 週間ビュー
│   ├── memorial/       # 記念日編集
│   ├── settings/       # 通知設定・予定表読み込み
│   └── login, signup   # 認証
├── components/         # Calendar, TodoList, Layout など
├── lib/                # タスク取得・キャッシュ・通知・DB など
└── types/              # 型定義
```

## ドキュメント

- **[TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md)** … 技術仕様（DB 設計、表示速度・キャッシュ、Optimistic UI、API など）
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** … 本番デプロイ（Vercel・環境変数・通知 Cron の設定）

## ライセンス

Private / 利用規約に従ってください。
