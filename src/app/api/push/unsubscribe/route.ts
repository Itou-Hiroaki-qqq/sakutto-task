import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

// POST: Web Pushサブスクリプションを削除
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // ユーザーのすべてのサブスクリプションを削除
        await sql`
            DELETE FROM web_push_subscriptions
            WHERE user_id = ${user.id}
        `;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to unsubscribe web push:', error);
        return NextResponse.json(
            { error: 'Failed to unsubscribe web push' },
            { status: 500 }
        );
    }
}
