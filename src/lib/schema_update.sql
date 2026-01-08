-- カスタム期間の単位を保存するカラムを追加
ALTER TABLE task_recurrences 
ADD COLUMN IF NOT EXISTS custom_unit VARCHAR(10) CHECK (custom_unit IN ('days', 'weeks', 'months', 'years'));

-- 既存データの更新（custom_daysが特定の値の場合）
-- これは参考用です。実際には既存データの値に応じて適切に設定してください

