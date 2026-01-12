-- カスタム期間の単位に「months_end」（～ヵ月おきの月末）を追加するためのマイグレーション
-- task_recurrencesテーブルのcustom_unitカラムのCHECK制約を更新

-- 既存のCHECK制約を削除
ALTER TABLE task_recurrences 
DROP CONSTRAINT IF EXISTS task_recurrences_custom_unit_check;

-- 新しいCHECK制約を追加（months_endを含む）
ALTER TABLE task_recurrences 
ADD CONSTRAINT task_recurrences_custom_unit_check 
CHECK (custom_unit IN ('days', 'weeks', 'months', 'months_end', 'years'));
