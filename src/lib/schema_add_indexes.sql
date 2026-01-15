-- パフォーマンス向上のための複合インデックス追加
-- task_completionsテーブルのクエリ最適化

-- task_completionsテーブルに(task_id, completed_date)の複合インデックス
-- タスクIDと日付の組み合わせで検索する際のパフォーマンス向上
CREATE INDEX IF NOT EXISTS idx_task_completions_task_id_date 
ON task_completions(task_id, completed_date);

-- task_exclusionsテーブルに(task_id, excluded_date)の複合インデックス
-- タスクIDと除外日付の組み合わせで検索する際のパフォーマンス向上
CREATE INDEX IF NOT EXISTS idx_task_exclusions_task_id_date 
ON task_exclusions(task_id, excluded_date);
