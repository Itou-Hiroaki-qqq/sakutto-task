import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMemorialsForDate, getAllMemorials } from '@/lib/memorials';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const dateStr = searchParams.get('date');

        if (dateStr) {
            // 特定日の記念日を取得
            const date = new Date(dateStr);
            const memorials = await getMemorialsForDate(user.id, date);
            return NextResponse.json({ memorials });
        } else {
            // すべての記念日を取得（リスト表示用）
            const memorials = await getAllMemorials(user.id);
            return NextResponse.json({ memorials });
        }
    } catch (error) {
        console.error('Error fetching memorials:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

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
        const {
            title,
            dueDate,
            notificationEnabled,
            notificationTime,
            yearlyEnabled,
        } = body;

        if (!title || !dueDate) {
            return NextResponse.json(
                { error: 'Title and due date are required' },
                { status: 400 }
            );
        }

        // 記念日を作成
        const memorialResult = await sql`
        INSERT INTO memorials (user_id, title, due_date, notification_enabled, notification_time)
        VALUES (${user.id}, ${title}, ${dueDate}, ${notificationEnabled}, ${notificationTime})
        RETURNING id
    `;

        const memorialId = memorialResult[0].id;

        // 毎年設定が有効な場合、繰り返し設定を追加
        if (yearlyEnabled) {
            await sql`
        INSERT INTO memorial_recurrences (memorial_id, type)
        VALUES (${memorialId}, 'yearly')
        `;
        }

        return NextResponse.json({ success: true, memorialId });
    } catch (error) {
        console.error('Error creating memorial:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

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
        const {
            memorialId,
            title,
            dueDate,
            notificationEnabled,
            notificationTime,
            yearlyEnabled,
        } = body;

        if (!memorialId || !title || !dueDate) {
            return NextResponse.json(
                { error: 'Memorial ID, title and due date are required' },
                { status: 400 }
            );
        }

        // 記念日を更新
        await sql`
        UPDATE memorials
        SET title = ${title},
            due_date = ${dueDate},
            notification_enabled = ${notificationEnabled},
            notification_time = ${notificationTime}
        WHERE id = ${memorialId} AND user_id = ${user.id}
    `;

        // 繰り返し設定を更新
        // 既存の繰り返し設定を削除
        await sql`
            DELETE FROM memorial_recurrences WHERE memorial_id = ${memorialId}
        `;
        
        // 毎年設定が有効な場合、繰り返し設定を追加
        if (yearlyEnabled) {
            await sql`
                INSERT INTO memorial_recurrences (memorial_id, type)
                VALUES (${memorialId}, 'yearly')
            `;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating memorial:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
