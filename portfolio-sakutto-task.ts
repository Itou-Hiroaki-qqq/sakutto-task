// ポートフォリオ用：さくっとタスクの情報（修正反映版）
// 中身のオブジェクトをコピーして portfolio の配列などに貼り付けてください。

export const sakuttoTaskPortfolio = {
    id: "sakutto-task",
    title: "さくっとタスク",
    category: "WebApp ｜ 自主制作",
    introduction: "カレンダーとタスクリストが一体化したタスク管理アプリ。繰り返しタスクや記念日設定、通知設定の他に、予定表の画像やPDFを読み込みタスク化する機能も備えている。",
    role: "Direction / Design / Coding",
    tools: "Figma / React / Next.js / TypeScript / Neon / supabaseAuth / vercel / GeminiAPI / cron-job.org",
    period: [
        { task: "企画・ワイヤーフレーム", duration: "3日" },
        { task: "デザイン", duration: "1日" },
        { task: "コーディング", duration: "12日" }
    ],
    description: [
        { dt: "制作概要", dd: "カレンダーとタスクリストが一体化したタスク管理Webアプリ。日々のタスクを効率的に管理し、指定時刻にメール通知を送信することで、タスクの見逃しを防ぐことを目的として開発した。繰り返しタスクや記念日管理など、実用的な機能を備えている。" },
        { dt: "アプリの特徴", dd: "カレンダー形式でタスクを視覚的に管理でき、日次・週次・月次・年次など柔軟な繰り返し設定に対応。繰り返し予定の編集では「この予定のみ変更」と「これ以降のすべての繰り返しも変更」のスコープを選択可能。AI（Gemini API）で予定表の画像・PDFからイベントを抽出してタスク化する機能を実装。表示は React State を唯一の真実とし、localStorage は初回表示のヒントのみに使用。タスク完了は Optimistic 更新で即反映し、保存時は即座に一覧へ戻り、DB 保存はバックグラウンドで実行するよう設計している。" },
        { dt: "コーディング", dd: "Next.js（App Router）と TypeScript でコンポーネント設計を行い、Supabase で認証、Neon Database（PostgreSQL）でデータ管理を実装。Gemini API による画像解析、Resend を使ったメール通知、cron-job.org による定期実行など、複数の外部サービスを統合。タスク編集画面では認証とタスク取得を並列化し、認証後はフォームの骨組みを即表示。API 結果は差分マージせず丸ごと setState で差し替え、状態の一貫性を保つようにした。" },
        { dt: "工夫点", dd: "localStorage は初回表示・日付切り替え時の即時表示にのみ使い、表示更新時には参照しない設計にし、React State とキャッシュの二重管理を避けた。タスク追加・編集後の戻り先では、sessionStorage で「表示用の上書きリスト」を渡し、一覧に戻った直後から追加・編集内容が表示され続けるようにした（先行して返る API レスポンスで上書きされないよう制御）。完了チェックは Optimistic に State を更新し、失敗時のみロールバック。カレンダーの日付クリックと URL 同期の競合を防ぎ、別の日を選んでも意図した日が表示されるようにした。予定表読み込みでは抽出結果の手動編集・追加・削除が可能な UI と、時間入力補完（「900」→「9:00?」）など細かな UX 改善も行った。" },
        {
            dt: "デモURL",
            dd: '<a href="https://sakutto-task.vercel.app/" target="_blank" rel="noopener noreferrer" class="link-hover">https://sakutto-task.vercel.app/</a>'
        }
    ],
    github: "https://github.com/Itou-Hiroaki-qqq/sakutto-task",
    imageMain: "/assets/img/worksApp_sakutto-task.png"
};
