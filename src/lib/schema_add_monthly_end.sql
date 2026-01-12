-- 毎月末（monthly_end）タイプを追加するためのマイグレーション
-- task_recurrencesテーブルのCHECK制約を更新

-- 既存のCHECK制約を削除
ALTER TABLE task_recurrences 
DROP CONSTRAINT IF EXISTS task_recurrences_type_check;

-- 新しいCHECK制約を追加（monthly_endを含む）
ALTER TABLE task_recurrences 
ADD CONSTRAINT task_recurrences_type_check 
CHECK (type IN ('daily', 'weekly', 'monthly', 'monthly_end', 'yearly', 'weekdays', 'custom'));
