import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sql } from '@/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ memorialId: string }> }
) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memorialId } = await params;

        // 記念日を取得
        const memorials = await sql`
        SELECT 
            m.id,
            m.title,
            m.due_date,
            m.notification_enabled,
            m.notification_time,
            mr.type as recurrence_type,
            mr.custom_days,
            mr.custom_unit,
            mr.weekdays as recurrence_weekdays
        FROM memorials m
        LEFT JOIN memorial_recurrences mr ON m.id = mr.memorial_id
        WHERE m.id = ${memorialId} AND m.user_id = ${user.id}
    `;

        if (memorials.length === 0) {
            return NextResponse.json({ error: 'Memorial not found' }, { status: 404 });
        }

        const memorial = memorials[0];

        return NextResponse.json({
            memorial: {
                id: memorial.id,
                title: memorial.title,
                due_date: memorial.due_date,
                notification_enabled: memorial.notification_enabled,
                notification_time: memorial.notification_time,
                recurrence: memorial.recurrence_type
                    ? {
                          type: memorial.recurrence_type,
                          custom_days: memorial.custom_days,
                          custom_unit: memorial.custom_unit,
                          weekdays: memorial.recurrence_weekdays,
                      }
                    : null,
            },
        });
    } catch (error) {
        console.error('Error fetching memorial:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ memorialId: string }> }
) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { memorialId } = await params;

        // 記念日を削除（CASCADEで繰り返し設定も削除される）
        await sql`
        DELETE FROM memorials
        WHERE id = ${memorialId} AND user_id = ${user.id}
    `;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting memorial:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
