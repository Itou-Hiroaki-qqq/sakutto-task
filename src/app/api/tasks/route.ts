import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTasksForDate } from '@/lib/tasks';
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

        if (!dateStr) {
            return NextResponse.json({ error: 'Date parameter is required' }, { status: 400 });
        }

        const date = new Date(dateStr);
        const tasks = await getTasksForDate(user.id, date);

        return NextResponse.json({ tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
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
            recurrenceType,
            customDays,
            customUnit,
            selectedWeekdays,
        } = body;

        if (!title || !dueDate) {
            return NextResponse.json(
                { error: 'Title and due date are required' },
                { status: 400 }
            );
        }

        // タスクを作成
        const taskResult = await sql`
        INSERT INTO tasks (user_id, title, due_date, notification_enabled, notification_time)
        VALUES (${user.id}, ${title}, ${dueDate}, ${notificationEnabled}, ${notificationTime})
        RETURNING id
    `;

        const taskId = taskResult[0].id;

        // 繰り返し設定がある場合
        if (recurrenceType) {
            await sql`
        INSERT INTO task_recurrences (task_id, type, custom_days, custom_unit, weekdays)
        VALUES (
            ${taskId},
            ${recurrenceType},
            ${customDays},
            ${customUnit || null},
            ${selectedWeekdays ? sql`${selectedWeekdays}::integer[]` : null}
        )
        `;
        }

        return NextResponse.json({ success: true, taskId });
    } catch (error: any) {
        console.error('Error creating task:', error);
        return NextResponse.json(
            { error: error?.message || 'Internal server error', details: error },
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
            taskId,
            title,
            dueDate,
            notificationEnabled,
            notificationTime,
            recurrenceType,
            customDays,
            customUnit,
            selectedWeekdays,
        } = body;

        if (!taskId || !title || !dueDate) {
            return NextResponse.json(
                { error: 'Task ID, title and due date are required' },
                { status: 400 }
            );
        }

        // タスクを更新
        await sql`
        UPDATE tasks
        SET title = ${title},
            due_date = ${dueDate},
            notification_enabled = ${notificationEnabled},
            notification_time = ${notificationTime}
        WHERE id = ${taskId} AND user_id = ${user.id}
    `;

        // 繰り返し設定を更新
        if (recurrenceType) {
            // 既存の繰り返し設定を削除
            await sql`
                DELETE FROM task_recurrences WHERE task_id = ${taskId}
            `;
            
            // 新しい繰り返し設定を挿入
            await sql`
                INSERT INTO task_recurrences (task_id, type, custom_days, custom_unit, weekdays)
                VALUES (
                    ${taskId},
                    ${recurrenceType},
                    ${customDays},
                    ${customUnit || null},
                    ${selectedWeekdays ? sql`${selectedWeekdays}::integer[]` : null}
                )
            `;
        } else {
            // 繰り返し設定が選択されていない場合は削除（チェックを外した場合）
            await sql`
                DELETE FROM task_recurrences WHERE task_id = ${taskId}
            `;
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error updating task:', error);
        return NextResponse.json(
            { error: error?.message || 'Internal server error', details: error },
            { status: 500 }
        );
    }
}
