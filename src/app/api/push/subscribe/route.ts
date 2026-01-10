import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

// POST: Web Pushサブスクリプションを保存
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { subscription } = body;

        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return NextResponse.json(
                { error: 'Invalid subscription data' },
                { status: 400 }
            );
        }

        // 既存のサブスクリプションを確認（同じエンドポイントがあれば更新）
        const existing = await sql`
            SELECT id FROM web_push_subscriptions
            WHERE endpoint = ${subscription.endpoint}
            LIMIT 1
        `;

        if (existing.length === 0) {
            // 新規作成
            await sql`
                INSERT INTO web_push_subscriptions (
                    user_id,
                    endpoint,
                    p256dh,
                    auth
                ) VALUES (
                    ${user.id},
                    ${subscription.endpoint},
                    ${subscription.keys.p256dh},
                    ${subscription.keys.auth}
                )
            `;
        } else {
            // 更新（ユーザーIDが変わった場合など）
            await sql`
                UPDATE web_push_subscriptions
                SET
                    user_id = ${user.id},
                    p256dh = ${subscription.keys.p256dh},
                    auth = ${subscription.keys.auth},
                    updated_at = CURRENT_TIMESTAMP
                WHERE endpoint = ${subscription.endpoint}
            `;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to save web push subscription:', error);
        return NextResponse.json(
            { error: 'Failed to save web push subscription' },
            { status: 500 }
        );
    }
}
