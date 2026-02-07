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

表示速度を保ちつつ状態不整合を防ぐため、以下の設計を採用している。

### 4.1 設計原則

- **表示の唯一の真実は React State**: 画面表示は常に React State に依存する
- **localStorage は「初回表示のヒント」に限定**: 即時表示のためだけに使用し、表示更新時には参照しない
- **API 取得データは丸ごと差し替え**: 差分マージは行わず、`setTasks(latest)` で上書きする
- **ユーザー操作は Optimistic Update**: React State に直接適用し、API 失敗時のみ再取得してロールバック

### 4.2 クライアント側キャッシュ（localStorage）

**モジュール**: `src/lib/tasksCache.ts`

| 項目 | 内容 |
|------|------|
| ストレージ | localStorage |
| キー形式 | `tasks_cache_{userId}` |
| キャッシュ範囲 | 現在日より**前1ヶ月**〜**後2ヶ月** |
| TTL | 5分（初回表示時は TTL 無視で即時表示） |
| データ構造 | `{ tasks: Record<yyyy-MM-dd, DisplayTask[]>, timestamp, startDate, endDate }` |

**用途**:
- 初回表示・日付切り替え時の即時表示（TTL 無視で取得）
- プリフェッチ結果の保存

**禁止事項**:
- 表示更新時に localStorage を再参照すること
- localStorage を使った差分マージ
- ユーザー操作後に localStorage を表示に使うこと

**主要関数**:
- `getCachedTasksForDateWithoutTTL()`: 初回表示用（TTL 無視）
- `updateTasksCache()`: キャッシュの更新（API 取得後・プリフェッチ後）
- `clearTasksCache()`: 特定日付または全体のキャッシュをクリア
- `isWithinCurrentMonthRange()`: キャッシュ対象範囲かどうかを判定

### 4.3 トップページの読み込みフロー

**モジュール**: `src/app/top/page.tsx`

```
1. 認証（useEffect）
2. 日付切り替え・初回ロード（useEffect: userId, selectedDate）
   ├─ キャッシュあり → 即座に setTasks(cached)、setLoading(false)
   └─ キャッシュなし → setLoading(true)
   ↓
   API fetch（tasks, memorials）
   ↓
   フェッチ完了時に表示日が一致していれば setTasks(latest) で丸ごと差し替え
   ↓
   キャッシュを更新（次回初回表示用）
3. プリフェッチ（useEffect: userId）: API 取得 → localStorage への保存のみ（setState しない）
```

### 4.4 状態更新の一本化

**日付切り替え時**:
- キャッシュがあれば即時表示
- API 取得後に `setTasks(latest)` で丸ごと差し替え（差分マージなし）
- 表示日が変わっていた場合は `setTasks` しない（誤適用防止）

**完了チェック時**:
1. `setTasks` で Optimistic に即更新
2. API をバックグラウンドで送信
3. 成功時: 表示はそのまま、キャッシュのみ更新（次回初回表示用）
4. 失敗時: 元の状態に戻し、API で再取得して `setTasks`

### 4.5 段階的プリフェッチ

- **範囲**: 現在日より前 1 ヶ月〜後 2 ヶ月（今日は除外）
- **責務**: API 取得 → localStorage への保存のみ。**setState は行わない**
- **フェーズ**:
  - Phase 1（100ms 後）: ±1 日
  - Phase 2（500ms 後）: ±7 日
  - Phase 3（1 秒後）: 残り
- **並列数**: 最大 8 リクエスト/バッチ
- **バッチ間隔**: 200ms
- **条件**: キャッシュが存在しない日付のみ取得

### 4.6 API エンドポイント

| エンドポイント | 用途 |
|----------------|------|
| `GET /api/tasks?date=` | 指定日のタスク取得（ロード・プリフェッチ） |
| `GET /api/tasks/range?centerDate=` | 日付範囲のタスク取得（別用途で利用可能） |

---

## 5. Optimistic UI

- **タスク完了トグル**: `setTasks` で即時反映し、API をバックグラウンド送信。成功時は表示を維持してキャッシュのみ更新、失敗時はロールバックして再取得
- **タスク追加・編集・削除**: 成功後にキャッシュを更新し、戻った際の初回表示を最新に保つ
- **差分マージなし**: API 結果は常に丸ごと `setState` で差し替え

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
- **フォーカス**: 編集ページロード完了後、タイトル入力欄へ自動フォーカス（useEffect + autoFocus）
- **時刻入力補助**: 「900」「1425」入力時に「9:00?」「14:25?」と候補表示、クリックで変換
- **繰り返し編集**: 開いた日の date パラメータ（TodoList から task.date で渡す）を期日の初期値に使用

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
- 表示速度・状態管理: React State を唯一の真実とし、localStorage は初回表示のヒントに限定。差分マージ・クールダウンを廃止し、単純で保守しやすい構成を採用している
