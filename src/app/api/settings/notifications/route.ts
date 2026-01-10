import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

// GET: 通知設定を取得
export async function GET() {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const result = await sql`
            SELECT 
                id,
                user_id,
                email,
                email_notification_enabled,
                web_push_enabled,
                created_at,
                updated_at
            FROM user_notification_settings
            WHERE user_id = ${user.id}
            LIMIT 1
        `;

        if (result.length === 0) {
            // 設定が存在しない場合はデフォルト値を返す（ログインメールアドレスを初期値として返す）
            return NextResponse.json({
                settings: {
                    email: user.email || null,
                    email_notification_enabled: false,
                    web_push_enabled: false,
                },
                loginEmail: user.email || null,
            });
        }

        const settings = result[0];
        return NextResponse.json({
            settings: {
                email: settings.email || null,
                email_notification_enabled: settings.email_notification_enabled || false,
                web_push_enabled: settings.web_push_enabled || false,
            },
            loginEmail: user.email || null,
        });
    } catch (error) {
        console.error('Failed to fetch notification settings:', error);
        return NextResponse.json(
            { error: 'Failed to fetch notification settings' },
            { status: 500 }
        );
    }
}

// PUT: 通知設定を更新
export async function PUT(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { email, email_notification_enabled, web_push_enabled } = body;

        // メールアドレスのバリデーション
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json(
                { error: 'Invalid email address' },
                { status: 400 }
            );
        }

        // 既存の設定を確認
        const existing = await sql`
            SELECT id FROM user_notification_settings
            WHERE user_id = ${user.id}
            LIMIT 1
        `;

        if (existing.length === 0) {
            // 新規作成
            await sql`
                INSERT INTO user_notification_settings (
                    user_id,
                    email,
                    email_notification_enabled,
                    web_push_enabled
                ) VALUES (
                    ${user.id},
                    ${email || null},
                    ${email_notification_enabled || false},
                    ${web_push_enabled || false}
                )
            `;
        } else {
            // 更新
            await sql`
                UPDATE user_notification_settings
                SET
                    email = ${email || null},
                    email_notification_enabled = ${email_notification_enabled || false},
                    web_push_enabled = ${web_push_enabled || false},
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ${user.id}
            `;
        }

        return NextResponse.json({
            success: true,
            settings: {
                email: email || null,
                email_notification_enabled: email_notification_enabled || false,
                web_push_enabled: web_push_enabled || false,
            },
        });
    } catch (error) {
        console.error('Failed to update notification settings:', error);
        return NextResponse.json(
            { error: 'Failed to update notification settings' },
            { status: 500 }
        );
    }
}
