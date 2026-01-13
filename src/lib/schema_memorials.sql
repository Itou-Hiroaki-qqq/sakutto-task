-- 記念日テーブル
CREATE TABLE IF NOT EXISTS memorials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    due_date DATE NOT NULL,
    notification_time VARCHAR(5), -- HH:mm形式
    notification_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 記念日の繰り返し設定テーブル
CREATE TABLE IF NOT EXISTS memorial_recurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memorial_id UUID NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'monthly_end', 'yearly', 'weekdays', 'custom')),
    custom_days INTEGER, -- カスタム期間の場合の日数
    custom_unit VARCHAR(10) CHECK (custom_unit IN ('days', 'weeks', 'months', 'months_end', 'years')),
    weekdays INTEGER[],  -- 指定曜日（0=日曜, 1=月曜, ..., 6=土曜）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_memorial FOREIGN KEY (memorial_id) REFERENCES memorials(id) ON DELETE CASCADE,
    CONSTRAINT unique_memorial_recurrence UNIQUE (memorial_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_memorials_user_id ON memorials(user_id);
CREATE INDEX IF NOT EXISTS idx_memorials_due_date ON memorials(due_date);
CREATE INDEX IF NOT EXISTS idx_memorial_recurrences_memorial_id ON memorial_recurrences(memorial_id);
