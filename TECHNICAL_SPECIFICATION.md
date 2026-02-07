# さくっとタスク 技術仕様書

## 1. 概要

「さくっとタスク」は、カレンダーと毎日のTodoリストが一体化したWebアプリケーションである。  
タスクの管理、繰り返し予定、記念日、メール通知、予定表のAI読み込みなど、実務で使いやすい機能を備える。

---

## 2. 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | Next.js (App Router) | 16.1.1 |
| 言語 | TypeScript | ^5 |
| UI | React | 19.2.3 |
| スタイリング | Tailwind CSS | ^4 |
| UI コンポーネント | DaisyUI | ^5.5.14 |
| 認証 | Supabase Auth | @supabase/ssr ^0.8.0, @supabase/supabase-js ^2.89.0 |
| データベース | Neon (PostgreSQL) | @neondatabase/serverless ^1.0.2 |
| 日付処理 | date-fns | ^4.1.0 |
| タイムゾーン | date-fns-tz | ^3.2.0 |
| メール送信 | Resend | ^6.7.0 |
| AI / OCR | Google Gemini API | gemini-2.5-flash |
| 定期実行 | cron-job.org | 5分間隔 |

---

## 3. データベース設計

### 3.1 主要テーブル

#### tasks（タスク）
| カラム | 型 | 説明 |
|--------|-----|------|
| id | UUID | 主キー |
| user_id | UUID | ユーザーID（Supabase Auth） |
| title | VARCHAR(255) | タイトル |
| due_date | DATE | 期日 |
| notification_time | VARCHAR(5) | 通知時刻（HH:mm） |
| notification_enabled | BOOLEAN | 通知有効フラグ |

#### task_recurrences（タスクの繰り返し設定）
| カラム | 型 | 説明 |
|--------|-----|------|
| task_id | UUID | タスクID |
| type | VARCHAR(20) | daily, weekly, monthly, monthly_end, yearly, weekdays, custom |
| custom_days | INTEGER | カスタム期間の日数 |
| custom_unit | VARCHAR | days, weeks, months, months_end, years |
| weekdays | INTEGER[] | 指定曜日（0=日曜〜6=土曜） |

#### task_completions（タスクの完了状態）
| カラム | 型 | 説明 |
|--------|-----|------|
| task_id | UUID | タスクID |
| completed_date | DATE | 完了日 |
| completed | BOOLEAN | 完了フラグ |

#### task_exclusions（繰り返しタスクの除外日）
| カラム | 型 | 説明 |
|--------|-----|------|
| task_id | UUID | タスクID |
| excluded_date | DATE | 除外日付 |
| exclusion_type | VARCHAR(20) | single（特定日のみ）, after（指定日以降） |

#### memorials（記念日）
tasks と同様の構造で、記念日用テーブル。memorial_recurrences で繰り返しを管理。

#### user_notification_settings（ユーザー通知設定）
| カラム | 型 | 説明 |
|--------|-----|------|
| user_id | UUID | ユーザーID |
| email | VARCHAR(255) | 通知用メールアドレス |
| email_notification_enabled | BOOLEAN | メール通知の有効/無効 |

---

## 4. 表示速度の技術構成（詳細）

表示速度向上のため、以下のハイブリッド方式を採用している。

### 4.1 全体の考え方

- **キャッシュファースト**: 初回表示・日付切り替え時は localStorage のキャッシュを即時表示
- **バックグラウンド更新**: キャッシュ表示後、非同期で API から最新データを取得し、差分があれば静かに更新
- **段階的プリフェッチ**: 利用頻度の高い日付（今日〜前後数日）を優先して事前読み込み
- **ユーザー操作の優先**: 今日・明日の操作直後は、古いバックグラウンド結果で上書きしない

### 4.2 クライアント側キャッシュ（localStorage）

**モジュール**: `src/lib/tasksCache.ts`

| 項目 | 内容 |
|------|------|
| ストレージ | localStorage |
| キー形式 | `tasks_cache_{userId}` |
| キャッシュ範囲 | 現在日より**前1ヶ月**〜**後2ヶ月** |
| TTL | 5分（初回表示時は TTL 無視で表示） |
| データ構造 | `{ tasks: Record<yyyy-MM-dd, DisplayTask[]>, timestamp, startDate, endDate }` |

**主要関数**:
- `getCachedTasksForDate()`: TTL チェックありでキャッシュ取得
- `getCachedTasksForDateWithoutTTL()`: 初回表示用（TTL 無視）
- `updateTasksCache()`: 既存キャッシュとマージして更新
- `clearTasksCache()`: 特定日付または全体のキャッシュをクリア
- `isWithinCurrentMonthRange()`: キャッシュ対象範囲かどうかを判定

### 4.3 トップページの読み込みフロー

**モジュール**: `src/app/top/page.tsx`

```
1. 認証チェック（Supabase Auth）
2. キャッシュ有無の判定
   ├─ キャッシュあり → 即座に setTasks(cachedTasks)、setLoading(false)
   │   └─ 100ms 後に loadLatestDataInBackground() を実行
   └─ キャッシュなし → loadTasksFromAPI() で API から取得
3. prefetchMonthRange() により、範囲内の他日付を段階的にプリフェッチ
```

### 4.4 バックグラウンド更新（loadLatestDataInBackground）

- **目的**: 表示中の日付の最新データを API で取得し、差分があれば更新
- **適用条件**:
  1. **今日・明日のクールダウン**: ユーザー操作後 15 秒以内は更新を適用しない
  2. **日付の整合性**: フェッチ完了時に、表示中の日付が変わっていれば適用しない
  3. **差分マージ**: `compareAndMergeTasks()` で差分のみ反映（完了状態を最優先）

### 4.5 ユーザー操作のクールダウン

**目的**: 今日・明日のタスクで、ユーザー操作直後に古いバックグラウンド結果で上書きされることを防ぐ。

| 項目 | 内容 |
|------|------|
| クールダウン時間 | 15 秒 |
| 記録対象 | 完了チェック、タスク追加・編集・削除 |
| 記録方法 | `lastUserActionAtRef`（Ref）＋ タスク編集ページ戻り時の sessionStorage |
| 適用日 | 今日・明日のみ |

**フロー**:
- 完了チェック時: `lastUserActionAtRef.current.set(dateStr, Date.now())`
- タスク編集ページから戻る時: `sessionStorage` に日付とタイムスタンプを保存し、トップページ読み込み時に Ref へ反映
- `loadLatestDataInBackground` 完了時: 今日・明日かつクールダウン中なら `setTasks` をスキップ

### 4.6 段階的プリフェッチ（prefetchMonthRange）

- **範囲**: 現在日より前 1 ヶ月〜後 2 ヶ月（今日は除外）
- **フェーズ**:
  - Phase 1（100ms 後）: ±1 日
  - Phase 2（500ms 後）: ±7 日
  - Phase 3（1 秒後）: 残り
- **並列数**: 最大 8 リクエスト/バッチ
- **バッチ間隔**: 200ms
- **条件**: キャッシュが存在しない日付のみ取得

### 4.7 今日・明日のデータ優先

- 完了チェック成功時: 今日・明日は API の最新データを直接反映（キャッシュの古いデータを使わない）
- その他の日付: `compareAndMergeTasks()` でマージし、差分があれば反映

### 4.8 API エンドポイント

| エンドポイント | 用途 |
|----------------|------|
| `GET /api/tasks?date=` | 指定日のタスク取得 |
| `GET /api/tasks/range?centerDate=` | 日付範囲のタスク取得（プリフェッチ・キャッシュ更新用） |

---

## 5. Optimistic UI

- **タスク完了トグル**: チェック操作を即時に反映し、バックグラウンドで API に送信。失敗時はロールバック
- **タスク追加・編集・削除**: 成功後にキャッシュを即時更新し、戻った際の表示を最新に保つ
- **エラー時**: アラート表示のうえ、元の状態にロールバック

---

## 6. 繰り返し予定の編集スコープ

繰り返し予定の編集時に、以下の 2 種類を選択可能。

| オプション | 挙動 |
|-----------|------|
| この予定のみ変更 | 該当日の除外を追加し、変更内容で新しい単発タスクを作成 |
| これ以降のすべての繰り返し予定も変更 | 元タスクを直接更新（従来仕様） |

**API**: `PUT /api/tasks` に `updateScope`（'this_only' | 'all_future'）と `targetDate` を付与。

---

## 7. 通知システム

### 7.1 スケジュール

- **実行**: cron-job.org により 5 分間隔
- **エンドポイント**: `GET /api/cron/notifications`
- **認証**: `Authorization: Bearer {CRON_SECRET}`

### 7.2 通知ロジック

- 日本時間（JST）の 5 分刻み時刻のみチェック
- 指定時刻に通知設定されているタスクを検索
- メール通知: Resend 経由で送信
- Web Push: 廃止済み（メール通知のみ利用）

### 7.3 キャッシュ

- 通知対象タスクの取得結果を 5 分間キャッシュ（サーバー側）

---

## 8. 予定表の読み込み（Event Calendar Import）

### 8.1 概要

画像・PDF の予定表を AI で解析し、タスクとして取り込む機能。

**パス**: `/settings/event-calendar`

### 8.2 技術構成

| 項目 | 内容 |
|------|------|
| AI モデル | Google Gemini API (gemini-2.5-flash) |
| 入力 | 画像（JPEG, PNG など）または PDF（最大 2 ファイル） |
| 出力 | JSON 形式のイベント一覧（date, title, description, type, keyword） |
| 時刻変換 | 「九時」「午後二時十五分」などを「9:00」「14:15」などに正規化 |

### 8.3 処理フロー

1. ファイルアップロード（ドラッグ＆ドロップまたはファイル選択）
2. Base64 エンコード後に Gemini API に送信
3. 抽出イベントの一覧を表示し、編集・追加・削除が可能
4. 選択したイベントをタスクとして保存（ジャンル名のプレフィックス対応）

---

## 9. その他の技術仕様

### 9.1 タスク入力

- **タイトル**: textarea により改行可能
- **時刻入力補助**: 「900」「1425」入力時に「9:00?」「14:25?」と候補表示、クリックで変換
- **繰り返し編集**: 開いた日の date パラメータから期日を初期表示（繰り返しの元日とは別に表示）

### 9.2 表示

- タスクタイトルの改行表示: `whitespace-pre-line` を適用
- TodoList、週間ビューで改行をそのまま表示

### 9.3 インフラ

- **ホスティング**: Vercel
- **認証**: Supabase Auth（クライアント・サーバー両方）
- **DB**: Neon PostgreSQL（サーバーレス）
- **環境変数**: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_*`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `CRON_SECRET` など

---

## 10. ディレクトリ構成（主要）

```
src/
├── app/
│   ├── api/
│   │   ├── cron/notifications/    # 通知 Cron エンドポイント
│   │   ├── event-calendar/upload/ # 予定表 AI 解析
│   │   ├── tasks/                 # タスク CRUD
│   │   │   ├── [taskId]/          # 取得・削除
│   │   │   ├── completion/        # 完了状態更新
│   │   │   └── range/             # 日付範囲取得
│   │   ├── memorials/             # 記念日 CRUD
│   │   └── settings/notifications/# 通知設定
│   ├── top/page.tsx               # メインタスク一覧（表示速度・キャッシュの中心）
│   ├── task/page.tsx              # タスク編集
│   ├── memorial/page.tsx          # 記念日編集
│   ├── weekly/page.tsx            # 週間ビュー
│   └── settings/event-calendar/   # 予定表読み込み
├── components/
│   ├── Calendar.tsx
│   ├── TodoList.tsx
│   └── ...
├── lib/
│   ├── tasksCache.ts              # クライアントキャッシュ
│   ├── tasks.ts                   # タスク取得ロジック（サーバー）
│   ├── notifications.ts           # 通知ロジック
│   └── ...
└── types/
    └── database.ts
```

---

## 11. バージョン情報

- 本仕様書は 2026 年 1 月時点の実装に基づく
- 表示速度に関しては、キャッシュ・プリフェッチ・クールダウンを組み合わせた構成で、安定した表示と操作感を実現している
