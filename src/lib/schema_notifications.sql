-- 通知機能用のテーブル追加

-- ユーザー通知設定テーブル
-- ユーザーごとの通知設定（メールアドレス、通知方法の選択など）を保存
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE, -- Supabase AuthのUUID
    email VARCHAR(255), -- 通知用メールアドレス（ログイン時のメールアドレスとは別）
    email_notification_enabled BOOLEAN DEFAULT FALSE, -- メール通知の有効/無効
    web_push_enabled BOOLEAN DEFAULT FALSE, -- Web Push通知の有効/無効
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_notification_settings UNIQUE (user_id)
);

-- Web Pushサブスクリプションテーブル
-- ユーザーのWeb Pushサブスクリプション情報を保存（1ユーザー複数デバイス対応）
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Supabase AuthのUUID
    endpoint TEXT NOT NULL, -- Push ServiceのエンドポイントURL
    p256dh TEXT NOT NULL, -- 公開鍵（暗号化用）
    auth TEXT NOT NULL, -- 認証シークレット
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_endpoint UNIQUE (endpoint)
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_user_id ON user_notification_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_id ON web_push_subscriptions(user_id);

-- updated_at自動更新のトリガー
CREATE TRIGGER update_user_notification_settings_updated_at BEFORE UPDATE ON user_notification_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_web_push_subscriptions_updated_at BEFORE UPDATE ON web_push_subscriptions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
