// タスクの繰り返しタイプ
export type RecurrenceType =
    | 'daily'        // 毎日
    | 'weekly'       // 毎週
    | 'monthly'      // 毎月
    | 'yearly'       // 毎年
    | 'weekdays'     // 指定曜日
    | 'custom';      // カスタム期間

// タスクの繰り返し設定
export interface TaskRecurrence {
    id: string;
    task_id: string;
    type: RecurrenceType;
    custom_days?: number;  // カスタム期間の場合の日数
    weekdays?: number[];   // 指定曜日（0=日曜, 1=月曜, ..., 6=土曜）
}

// タスクの基本情報
export interface Task {
    id: string;
    user_id: string;
    title: string;
    due_date: Date;
    notification_time?: string;  // HH:mm形式
    notification_enabled: boolean;
    created_at: Date;
    updated_at: Date;
}

// タスクの完了状態
export interface TaskCompletion {
    id: string;
    task_id: string;
    completed_date: Date;
    completed: boolean;
    created_at: Date;
}

// 日本の祝日情報（カレンダー表示用）
export interface Holiday {
    date: Date;
    name: string;
    type: 'national' | 'bank' | 'other';  // 国民の祝日、銀行休業日、その他
}

// 表示用のタスク（繰り返し展開後）
export interface DisplayTask {
    id: string;
    task_id: string;
    title: string;
    date: Date;
    due_date: Date;
    notification_time?: string;
    completed: boolean;
    is_holiday?: boolean;
    holiday_name?: string;
}

