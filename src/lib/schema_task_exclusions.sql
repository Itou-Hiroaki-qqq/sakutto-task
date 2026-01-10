-- 繰り返しタスクの除外日管理テーブル
-- 特定の日付の繰り返しタスクを除外する、または指定日以降の繰り返しタスクを除外する

CREATE TABLE IF NOT EXISTS task_exclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL,
    excluded_date DATE NOT NULL, -- 除外する日付
    exclusion_type VARCHAR(20) NOT NULL CHECK (exclusion_type IN ('single', 'after')), -- 'single': 特定日のみ除外, 'after': 指定日以降除外
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT unique_task_exclusion UNIQUE (task_id, excluded_date, exclusion_type)
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_task_exclusions_task_id ON task_exclusions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_exclusions_date ON task_exclusions(excluded_date);
